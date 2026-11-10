-- Supplier invoice three-way matching: supplier invoice -> purchase order -> posted goods receipts.
-- Additive and forward-only. No production data is modified by this repository change.

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_id_org_uidx ON public.supplier_invoices(id,organization_id);

CREATE TABLE IF NOT EXISTS public.supplier_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  match_status text NOT NULL CHECK (match_status IN ('matched','matched_with_variance')),
  variance_reason text,
  matched_by uuid REFERENCES auth.users(id),
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,supplier_invoice_id),
  UNIQUE (id,organization_id),
  FOREIGN KEY (supplier_invoice_id,organization_id)
    REFERENCES public.supplier_invoices(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_order_id,organization_id)
    REFERENCES public.purchase_orders(id,organization_id) ON DELETE RESTRICT,
  CHECK (match_status<>'matched_with_variance' OR nullif(trim(variance_reason),'') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.supplier_invoice_match_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_id uuid NOT NULL,
  goods_receipt_line_id uuid NOT NULL,
  quantity_invoiced numeric(18,4) NOT NULL CHECK (quantity_invoiced>0),
  invoiced_unit_price numeric(18,2) NOT NULL CHECK (invoiced_unit_price>=0),
  line_subtotal numeric(18,2) NOT NULL CHECK (line_subtotal>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id,goods_receipt_line_id),
  FOREIGN KEY (match_id,organization_id)
    REFERENCES public.supplier_invoice_matches(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (goods_receipt_line_id,organization_id)
    REFERENCES public.goods_receipt_lines(id,organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS supplier_invoice_matches_po_idx
  ON public.supplier_invoice_matches(organization_id,purchase_order_id);
CREATE INDEX IF NOT EXISTS supplier_invoice_match_lines_receipt_idx
  ON public.supplier_invoice_match_lines(organization_id,goods_receipt_line_id);

ALTER TABLE public.supplier_invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_match_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invoice_matches,public.supplier_invoice_match_lines FROM PUBLIC,anon;
DROP POLICY IF EXISTS supplier_invoice_matches_org_select ON public.supplier_invoice_matches;
CREATE POLICY supplier_invoice_matches_org_select ON public.supplier_invoice_matches
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS supplier_invoice_match_lines_org_select ON public.supplier_invoice_match_lines;
CREATE POLICY supplier_invoice_match_lines_org_select ON public.supplier_invoice_match_lines
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
GRANT SELECT ON public.supplier_invoice_matches,public.supplier_invoice_match_lines TO authenticated;
GRANT ALL ON public.supplier_invoice_matches,public.supplier_invoice_match_lines TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_supplier_invoice_to_receipts(
  p_org uuid,
  p_supplier_invoice uuid,
  p_purchase_order uuid,
  p_allocations jsonb,
  p_variance_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice public.supplier_invoices%rowtype;
  v_order public.purchase_orders%rowtype;
  v_allocation jsonb;
  v_receipt_line public.goods_receipt_lines%rowtype;
  v_receipt public.goods_receipts%rowtype;
  v_order_line public.purchase_order_lines%rowtype;
  v_match uuid;
  v_qty numeric(18,4);
  v_price numeric(18,2);
  v_subtotal numeric(18,2);
  v_allocated numeric(18,2):=0;
  v_previously_matched numeric(18,4);
  v_variance boolean:=false;
  v_count integer:=0;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array'
     OR jsonb_array_length(p_allocations)<1 OR jsonb_array_length(p_allocations)>200 THEN
    RAISE EXCEPTION 'Les lignes de rapprochement doivent contenir entre 1 et 200 réceptions.';
  END IF;

  SELECT * INTO v_invoice FROM public.supplier_invoices
   WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Facture fournisseur absente, brouillon ou annulée.';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders
   WHERE id=p_purchase_order AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_order.supplier_id<>v_invoice.supplier_id OR v_order.status NOT IN ('submitted','partially_received','received') THEN
    RAISE EXCEPTION 'La commande doit appartenir au même fournisseur et être soumise.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_invoice_matches
             WHERE organization_id=p_org AND supplier_invoice_id=v_invoice.id) THEN
    RAISE EXCEPTION 'Cette facture fournisseur possède déjà un rapprochement.';
  END IF;
  IF abs(v_invoice.total-v_invoice.subtotal-v_invoice.tax_total)>0.01 OR v_invoice.total<=0 THEN
    RAISE EXCEPTION 'Les totaux de la facture fournisseur sont incohérents.';
  END IF;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF jsonb_typeof(v_allocation)<>'object'
       OR nullif(v_allocation->>'goods_receipt_line_id','') IS NULL
       OR nullif(v_allocation->>'quantity','') IS NULL
       OR nullif(v_allocation->>'unit_price','') IS NULL THEN
      RAISE EXCEPTION 'Chaque ligne doit préciser réception, quantité et prix unitaire.';
    END IF;
    v_qty:=(v_allocation->>'quantity')::numeric;
    v_price:=(v_allocation->>'unit_price')::numeric;
    IF v_qty<=0 OR v_price<0 THEN RAISE EXCEPTION 'Quantité ou prix facturé invalide.'; END IF;

    SELECT * INTO v_receipt_line FROM public.goods_receipt_lines
     WHERE id=(v_allocation->>'goods_receipt_line_id')::uuid AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de réception introuvable.'; END IF;
    SELECT * INTO v_receipt FROM public.goods_receipts
     WHERE id=v_receipt_line.goods_receipt_id AND organization_id=p_org;
    IF NOT FOUND OR v_receipt.status<>'posted' OR v_receipt.purchase_order_id<>v_order.id THEN
      RAISE EXCEPTION 'La ligne doit provenir d''une réception validée de la commande sélectionnée.';
    END IF;
    SELECT * INTO v_order_line FROM public.purchase_order_lines
     WHERE id=v_receipt_line.purchase_order_line_id AND organization_id=p_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande source introuvable.'; END IF;

    SELECT coalesce(sum(ml.quantity_invoiced),0) INTO v_previously_matched
      FROM public.supplier_invoice_match_lines ml
      JOIN public.supplier_invoice_matches m ON m.id=ml.match_id AND m.organization_id=ml.organization_id
     WHERE ml.organization_id=p_org AND ml.goods_receipt_line_id=v_receipt_line.id;
    IF v_qty>v_receipt_line.quantity_received-v_previously_matched+0.00000001 THEN
      RAISE EXCEPTION 'La quantité facturée dépasse la quantité reçue encore non rapprochée.';
    END IF;
    IF abs(v_price-v_order_line.unit_price)>0.01 THEN v_variance:=true; END IF;
    v_allocated:=v_allocated+round(v_qty*v_price,2);
    v_count:=v_count+1;
  END LOOP;

  IF abs(v_allocated-v_invoice.subtotal)>0.01 THEN
    RAISE EXCEPTION 'Le sous-total des lignes rapprochées (%) ne correspond pas au sous-total de la facture (%).',
      v_allocated,v_invoice.subtotal;
  END IF;
  IF v_variance AND nullif(trim(coalesce(p_variance_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Un écart de prix avec la commande doit être justifié.';
  END IF;

  INSERT INTO public.supplier_invoice_matches(
    organization_id,supplier_invoice_id,purchase_order_id,match_status,variance_reason,matched_by
  ) VALUES(
    p_org,v_invoice.id,v_order.id,
    CASE WHEN v_variance THEN 'matched_with_variance' ELSE 'matched' END,
    CASE WHEN v_variance THEN trim(p_variance_reason) ELSE NULL END,auth.uid()
  ) RETURNING id INTO v_match;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    v_qty:=(v_allocation->>'quantity')::numeric;
    v_price:=(v_allocation->>'unit_price')::numeric;
    INSERT INTO public.supplier_invoice_match_lines(
      organization_id,match_id,goods_receipt_line_id,quantity_invoiced,invoiced_unit_price,line_subtotal
    ) VALUES(p_org,v_match,(v_allocation->>'goods_receipt_line_id')::uuid,v_qty,v_price,round(v_qty*v_price,2));
  END LOOP;

  PERFORM public.audit_event(p_org,'supplier_invoice.reconciled','supplier_invoice',v_invoice.id,NULL,
    jsonb_build_object('purchase_order_id',v_order.id,'match_id',v_match,'matched_subtotal',v_allocated,
      'tax_total',v_invoice.tax_total,'line_count',v_count,'status',CASE WHEN v_variance THEN 'matched_with_variance' ELSE 'matched' END,
      'variance_reason',CASE WHEN v_variance THEN trim(p_variance_reason) ELSE NULL END));
  RETURN v_match;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text) TO authenticated;


CREATE OR REPLACE FUNCTION public.reconcile_supplier_invoice_to_posted_receipts(
  p_org uuid,p_supplier_invoice uuid,p_purchase_order uuid,p_variance_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_allocations jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  SELECT jsonb_agg(jsonb_build_object(
    'goods_receipt_line_id',x.goods_receipt_line_id,
    'quantity',x.quantity_remaining,
    'unit_price',x.unit_cost
  ) ORDER BY x.goods_receipt_line_id)
  INTO v_allocations
  FROM (
    SELECT grl.id goods_receipt_line_id,
           (grl.quantity_received-coalesce(sum(ml.quantity_invoiced),0))::numeric(18,4) quantity_remaining,
           grl.unit_cost
    FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=grl.organization_id
    LEFT JOIN public.supplier_invoice_match_lines ml
      ON ml.goods_receipt_line_id=grl.id AND ml.organization_id=grl.organization_id
    LEFT JOIN public.supplier_invoice_matches sm
      ON sm.id=ml.match_id AND sm.organization_id=ml.organization_id
    WHERE grl.organization_id=p_org AND gr.purchase_order_id=p_purchase_order AND gr.status='posted'
    GROUP BY grl.id,grl.quantity_received,grl.unit_cost
    HAVING grl.quantity_received-coalesce(sum(ml.quantity_invoiced),0)>0.00000001
  ) x;
  IF coalesce(jsonb_array_length(v_allocations),0)=0 THEN
    RAISE EXCEPTION 'Aucune quantité reçue non encore rapprochée pour cette commande.';
  END IF;
  RETURN public.reconcile_supplier_invoice_to_receipts(
    p_org,p_supplier_invoice,p_purchase_order,v_allocations,p_variance_reason
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_supplier_invoice_to_posted_receipts(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_invoice_to_posted_receipts(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE VIEW public.magnisa_supplier_invoice_match_reconciliation
WITH (security_invoker=true) AS
SELECT si.organization_id,si.id supplier_invoice_id,si.supplier_number,si.supplier_id,si.total invoice_total,
       coalesce(m.match_status,'unmatched') match_status,m.purchase_order_id,po.number purchase_order_number,
       coalesce(sum(ml.line_subtotal),0)::numeric(18,2) matched_subtotal,
       (si.subtotal-coalesce(sum(ml.line_subtotal),0))::numeric(18,2) unmatched_subtotal,
       m.variance_reason,m.matched_at
FROM public.supplier_invoices si
LEFT JOIN public.supplier_invoice_matches m
  ON m.supplier_invoice_id=si.id AND m.organization_id=si.organization_id
LEFT JOIN public.purchase_orders po
  ON po.id=m.purchase_order_id AND po.organization_id=m.organization_id
LEFT JOIN public.supplier_invoice_match_lines ml
  ON ml.match_id=m.id AND ml.organization_id=m.organization_id
GROUP BY si.organization_id,si.id,si.supplier_number,si.supplier_id,si.total,si.subtotal,
         m.match_status,m.purchase_order_id,po.number,m.variance_reason,m.matched_at;
REVOKE ALL ON public.magnisa_supplier_invoice_match_reconciliation FROM PUBLIC,anon;
GRANT SELECT ON public.magnisa_supplier_invoice_match_reconciliation TO authenticated;
