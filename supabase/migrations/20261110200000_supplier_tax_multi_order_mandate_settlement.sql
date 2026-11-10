-- Complete supplier reconciliation, tax capture and customer-mandate settlement.
-- Forward-only; no production operation is performed by this migration file.

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS additional_cost_amount numeric(18,2) NOT NULL DEFAULT 0;
DO $purchase_cost_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_lines'::regclass AND conname='purchase_order_lines_discount_nonnegative') THEN
    ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_discount_nonnegative CHECK (discount_amount>=0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_lines'::regclass AND conname='purchase_order_lines_additional_cost_nonnegative') THEN
    ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_additional_cost_nonnegative CHECK (additional_cost_amount>=0);
  END IF;
END
$purchase_cost_constraints$;

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS tax_document_reference text;

DO $tax_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_tax_treatment_check') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_tax_treatment_check
      CHECK (tax_treatment IN ('not_applicable','recoverable','nonrecoverable'));
  END IF;
END
$tax_check$;

ALTER TABLE public.supplier_invoice_matches
  DROP CONSTRAINT IF EXISTS supplier_invoice_matches_organization_id_supplier_invoice_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_matches_invoice_order_uidx
  ON public.supplier_invoice_matches(organization_id,supplier_invoice_id,purchase_order_id);

-- VAT recoverable is deliberately mapped to PCG 4456 only when the operator
-- explicitly marks it recoverable and retains the supporting supplier document reference.
INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('4456','État, TVA déductible sur autres biens et services','asset')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_supplier_invoice_with_tax(
  p_org uuid,p_supplier uuid,p_supplier_number text,p_invoice_date date,p_due_date date,
  p_subtotal numeric,p_tax_total numeric,p_tax_treatment text,p_tax_document_reference text,
  p_notes text,p_reconciliation_scope text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice uuid;
  v_entry uuid;
  v_supplier_name text;
  v_existing public.supplier_invoices%rowtype;
  v_ref text;
  v_total numeric(18,2);
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_subtotal IS NULL OR p_subtotal<=0 OR p_tax_total IS NULL OR p_tax_total<0 THEN
    RAISE EXCEPTION 'Le sous-total et la TVA de la facture sont invalides.';
  END IF;
  IF p_tax_treatment NOT IN ('not_applicable','recoverable','nonrecoverable') THEN
    RAISE EXCEPTION 'Traitement de TVA invalide.';
  END IF;
  IF p_tax_treatment='not_applicable' AND p_tax_total<>0 THEN
    RAISE EXCEPTION 'Une facture sans TVA ne peut pas contenir de montant de TVA.';
  END IF;
  IF p_tax_treatment='recoverable' AND (p_tax_total<=0 OR nullif(trim(coalesce(p_tax_document_reference,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'La TVA déductible exige un montant et une référence de justificatif fournisseur.';
  END IF;
  IF p_reconciliation_scope NOT IN ('goods_procurement','service_or_other') THEN
    RAISE EXCEPTION 'Nature de facture fournisseur invalide.';
  END IF;
  IF p_invoice_date IS NULL OR (p_due_date IS NOT NULL AND p_due_date<p_invoice_date) THEN
    RAISE EXCEPTION 'Date ou échéance de facture invalide.';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_invoice_date);
  v_total:=round(p_subtotal+p_tax_total,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'Le total de la facture doit être positif.'; END IF;
  v_ref:=nullif(trim(coalesce(p_supplier_number,'')),'');
  IF v_ref IS NULL THEN RAISE EXCEPTION 'Numéro de facture fournisseur requis.'; END IF;
  SELECT name INTO v_supplier_name FROM public.suppliers
   WHERE id=p_supplier AND organization_id=p_org AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable ou inactif.'; END IF;
  SELECT * INTO v_existing FROM public.supplier_invoices
   WHERE organization_id=p_org AND supplier_id=p_supplier AND supplier_number=v_ref FOR UPDATE;
  IF FOUND THEN
    IF v_existing.invoice_date=p_invoice_date AND v_existing.due_date IS NOT DISTINCT FROM p_due_date
       AND v_existing.subtotal=round(p_subtotal,2) AND v_existing.tax_total=round(p_tax_total,2)
       AND v_existing.tax_treatment=p_tax_treatment
       AND coalesce(v_existing.tax_document_reference,'')=coalesce(nullif(trim(p_tax_document_reference),''),'')
       AND v_existing.reconciliation_scope=p_reconciliation_scope THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Ce numéro de facture fournisseur existe déjà avec des données différentes.';
  END IF;

  INSERT INTO public.supplier_invoices(
    organization_id,supplier_id,supplier_number,invoice_date,due_date,subtotal,tax_total,total,
    paid_amount,balance_due,status,notes,created_by,reconciliation_scope,tax_treatment,tax_document_reference
  ) VALUES(
    p_org,p_supplier,v_ref,p_invoice_date,p_due_date,round(p_subtotal,2),round(p_tax_total,2),v_total,
    0,v_total,'validated',nullif(trim(coalesce(p_notes,'')),''),auth.uid(),
    p_reconciliation_scope,p_tax_treatment,nullif(trim(coalesce(p_tax_document_reference,'')),'')
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  ) VALUES(
    p_org,p_invoice_date,'FOUR-'||v_ref,
    'Facture fournisseur '||v_supplier_name||' — '||v_ref,
    'supplier_invoice',v_invoice,v_total,v_total
  ) RETURNING id INTO v_entry;

  IF p_tax_treatment='recoverable' THEN
    INSERT INTO public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) VALUES
      (p_org,v_entry,'EXPENSE:SUPPLIER','Achats et sous-traitance',round(p_subtotal,2),0),
      (p_org,v_entry,'TAX:SUPPLIER_INPUT','TVA déductible sur factures fournisseurs',round(p_tax_total,2),0),
      (p_org,v_entry,'AP','Dettes fournisseurs',0,v_total);
    INSERT INTO public.pcg2005_supplier_invoice_mappings(
      organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment
    ) VALUES(
      p_org,v_invoice,'TAX:SUPPLIER_INPUT','4456',
      'TVA déclarée déductible sur facture fournisseur ; la pièce justificative originale doit être archivée.',
      'record_only',true
    ) ON CONFLICT (organization_id,supplier_invoice_id,account_key) DO NOTHING;
  ELSE
    INSERT INTO public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) VALUES
      (p_org,v_entry,'EXPENSE:SUPPLIER','Achats et sous-traitance',v_total,0),
      (p_org,v_entry,'AP','Dettes fournisseurs',0,v_total);
  END IF;

  PERFORM public.audit_event(p_org,'supplier_invoice.validated','supplier_invoice',v_invoice,NULL,
    jsonb_build_object('supplier_id',p_supplier,'supplier_number',v_ref,'subtotal',p_subtotal,
      'tax_total',p_tax_total,'total',v_total,'tax_treatment',p_tax_treatment,
      'reconciliation_scope',p_reconciliation_scope,'journal_entry_id',v_entry));
  RETURN v_invoice;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text) TO authenticated;

-- A single supplier invoice may now cover several purchase orders. One match header
-- is stored per order, while the RPC validates the invoice subtotal across all lines.
CREATE OR REPLACE FUNCTION public.reconcile_supplier_invoice_multi_order(
  p_org uuid,p_supplier_invoice uuid,p_allocations jsonb,p_variance_reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice public.supplier_invoices%rowtype;
  v_alloc jsonb;
  v_receipt_line public.goods_receipt_lines%rowtype;
  v_receipt public.goods_receipts%rowtype;
  v_order public.purchase_orders%rowtype;
  v_order_line public.purchase_order_lines%rowtype;
  v_match uuid;
  v_qty numeric(18,4);
  v_price numeric(18,2);
  v_allocated numeric(18,2):=0;
  v_previous numeric(18,4);
  v_variance boolean;
  v_order_id uuid;
  v_count integer:=0;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array'
     OR jsonb_array_length(p_allocations)<1 OR jsonb_array_length(p_allocations)>300 THEN
    RAISE EXCEPTION 'Le rapprochement doit contenir entre 1 et 300 lignes de réception.';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_allocations)) <>
     (SELECT count(DISTINCT value->>'goods_receipt_line_id') FROM jsonb_array_elements(p_allocations)) THEN
    RAISE EXCEPTION 'Une ligne de réception ne peut apparaître qu''une seule fois dans une facture.';
  END IF;

  SELECT * INTO v_invoice FROM public.supplier_invoices
   WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Facture fournisseur absente, brouillon ou annulée.';
  END IF;
  IF v_invoice.reconciliation_scope<>'goods_procurement' THEN
    RAISE EXCEPTION 'Seules les factures d''achats de biens sont rapprochables des commandes.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_invoice_matches WHERE organization_id=p_org AND supplier_invoice_id=v_invoice.id) THEN
    RAISE EXCEPTION 'Cette facture possède déjà un rapprochement ; annule ou corrige celui-ci avant une nouvelle opération.';
  END IF;
  IF abs(v_invoice.total-v_invoice.subtotal-v_invoice.tax_total)>0.01 OR v_invoice.total<=0 THEN
    RAISE EXCEPTION 'Les totaux HT, TVA et TTC de la facture sont incohérents.';
  END IF;

  FOR v_alloc IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    IF nullif(v_alloc->>'goods_receipt_line_id','') IS NULL
       OR nullif(v_alloc->>'quantity','') IS NULL OR nullif(v_alloc->>'unit_price','') IS NULL THEN
      RAISE EXCEPTION 'Chaque ligne doit préciser réception, quantité et prix unitaire.';
    END IF;
    v_qty:=(v_alloc->>'quantity')::numeric;
    v_price:=(v_alloc->>'unit_price')::numeric;
    IF v_qty<=0 OR v_price<0 THEN RAISE EXCEPTION 'Quantité ou prix facturé invalide.'; END IF;
    SELECT * INTO v_receipt_line FROM public.goods_receipt_lines
     WHERE id=(v_alloc->>'goods_receipt_line_id')::uuid AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de réception introuvable.'; END IF;
    SELECT * INTO v_receipt FROM public.goods_receipts
     WHERE id=v_receipt_line.goods_receipt_id AND organization_id=p_org;
    IF NOT FOUND OR v_receipt.status<>'posted' THEN RAISE EXCEPTION 'La réception doit être validée.'; END IF;
    SELECT * INTO v_order FROM public.purchase_orders
     WHERE id=v_receipt.purchase_order_id AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND OR v_order.supplier_id<>v_invoice.supplier_id
       OR v_order.status NOT IN ('submitted','partially_received','received') THEN
      RAISE EXCEPTION 'Chaque commande doit être soumise et appartenir au fournisseur de la facture.';
    END IF;
    SELECT * INTO v_order_line FROM public.purchase_order_lines
     WHERE id=v_receipt_line.purchase_order_line_id AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND OR v_order_line.purchase_order_id<>v_order.id
       OR v_order_line.purchase_purpose='customer_mandate' THEN
      RAISE EXCEPTION 'Les achats sous mandat client ne peuvent pas être rapprochés comme dette de l''entreprise.';
    END IF;
    SELECT coalesce(sum(ml.quantity_invoiced),0) INTO v_previous
      FROM public.supplier_invoice_match_lines ml
      JOIN public.supplier_invoice_matches sm ON sm.id=ml.match_id AND sm.organization_id=ml.organization_id
     WHERE ml.organization_id=p_org AND ml.goods_receipt_line_id=v_receipt_line.id;
    IF v_qty>v_receipt_line.quantity_received-v_previous+0.00000001 THEN
      RAISE EXCEPTION 'La quantité facturée dépasse le reliquat reçu non encore facturé.';
    END IF;
    IF abs(v_price-v_order_line.unit_price)>0.01 AND nullif(trim(coalesce(p_variance_reason,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Un écart de prix doit être justifié.';
    END IF;
    v_allocated:=v_allocated+round(v_qty*v_price,2);
    v_count:=v_count+1;
  END LOOP;

  IF abs(v_allocated-v_invoice.subtotal)>0.01 THEN
    RAISE EXCEPTION 'Le total HT rapproché (%) doit égaler le sous-total HT de la facture (%).',v_allocated,v_invoice.subtotal;
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT gr.purchase_order_id
    FROM jsonb_array_elements(p_allocations) a
    JOIN public.goods_receipt_lines grl ON grl.id=(a.value->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
    JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_allocations) a
      JOIN public.goods_receipt_lines grl ON grl.id=(a.value->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
      JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
      JOIN public.purchase_order_lines pol ON pol.id=grl.purchase_order_line_id AND pol.organization_id=p_org
      WHERE gr.purchase_order_id=v_order_id
        AND abs((a.value->>'unit_price')::numeric-pol.unit_price)>0.01
    ) INTO v_variance;
    INSERT INTO public.supplier_invoice_matches(
      organization_id,supplier_invoice_id,purchase_order_id,match_status,variance_reason,matched_by
    ) VALUES(
      p_org,v_invoice.id,v_order_id,
      CASE WHEN v_variance THEN 'matched_with_variance' ELSE 'matched' END,
      CASE WHEN v_variance THEN trim(p_variance_reason) ELSE NULL END,auth.uid()
    ) RETURNING id INTO v_match;

    INSERT INTO public.supplier_invoice_match_lines(
      organization_id,match_id,goods_receipt_line_id,quantity_invoiced,invoiced_unit_price,line_subtotal
    )
    SELECT p_org,v_match,grl.id,(a.value->>'quantity')::numeric,(a.value->>'unit_price')::numeric,
      round((a.value->>'quantity')::numeric*(a.value->>'unit_price')::numeric,2)
    FROM jsonb_array_elements(p_allocations) a
    JOIN public.goods_receipt_lines grl ON grl.id=(a.value->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
    JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
    WHERE gr.purchase_order_id=v_order_id;
  END LOOP;

  PERFORM public.audit_event(p_org,'supplier_invoice.multi_order_reconciled','supplier_invoice',v_invoice.id,NULL,
    jsonb_build_object('match_count',(SELECT count(*) FROM public.supplier_invoice_matches WHERE organization_id=p_org AND supplier_invoice_id=v_invoice.id),
      'matched_subtotal',v_allocated,'line_count',v_count,'variance_reason',p_variance_reason));
  RETURN (SELECT count(*)::integer FROM public.supplier_invoice_matches WHERE organization_id=p_org AND supplier_invoice_id=v_invoice.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text) TO authenticated;

DROP VIEW IF EXISTS public.magnisa_supplier_invoice_match_reconciliation;
CREATE VIEW public.magnisa_supplier_invoice_match_reconciliation
WITH (security_invoker=true) AS
SELECT si.organization_id,si.id supplier_invoice_id,si.supplier_number,si.supplier_id,si.total invoice_total,
       coalesce(bool_and(m.match_status='matched'),'false')::boolean AS all_matches_without_variance,
       CASE WHEN count(m.id)=0 THEN 'unmatched'
            WHEN sum(coalesce(ml.line_subtotal,0))<si.subtotal-0.01 THEN 'partially_matched'
            WHEN bool_and(m.match_status='matched') THEN 'matched'
            ELSE 'matched_with_variance' END AS match_status,
       string_agg(DISTINCT po.number,', ' ORDER BY po.number) purchase_order_number,
       coalesce(sum(ml.line_subtotal),0)::numeric(18,2) matched_subtotal,
       (si.subtotal-coalesce(sum(ml.line_subtotal),0))::numeric(18,2) unmatched_subtotal,
       string_agg(DISTINCT m.variance_reason,'; ') FILTER (WHERE m.variance_reason IS NOT NULL) variance_reason,
       max(m.matched_at) matched_at
FROM public.supplier_invoices si
LEFT JOIN public.supplier_invoice_matches m ON m.supplier_invoice_id=si.id AND m.organization_id=si.organization_id
LEFT JOIN public.purchase_orders po ON po.id=m.purchase_order_id AND po.organization_id=m.organization_id
LEFT JOIN public.supplier_invoice_match_lines ml ON ml.match_id=m.id AND ml.organization_id=m.organization_id
WHERE si.reconciliation_scope='goods_procurement'
GROUP BY si.organization_id,si.id,si.supplier_number,si.supplier_id,si.total,si.subtotal;
REVOKE ALL ON public.magnisa_supplier_invoice_match_reconciliation FROM PUBLIC,anon;
GRANT SELECT ON public.magnisa_supplier_invoice_match_reconciliation TO authenticated;

-- Customer-mandate goods belong to the customer, not to the company's stock or
-- supplier payable. Company-paid disbursements are recorded in a dedicated
-- receivable subledger (PCG 467), then cleared by customer reimbursement.
CREATE TABLE IF NOT EXISTS public.customer_mandate_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_document_reference text NOT NULL,
  document_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount>0),
  financial_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  disbursed_at date NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  request_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,request_key),
  FOREIGN KEY (purchase_order_line_id,organization_id)
    REFERENCES public.purchase_order_lines(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id,organization_id)
    REFERENCES public.customers(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id,organization_id)
    REFERENCES public.suppliers(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.customer_mandate_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  disbursement_id uuid NOT NULL,
  financial_account_id uuid NOT NULL REFERENCES public.financial_accounts(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount>0),
  reimbursement_date date NOT NULL,
  reference text,
  request_key uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,request_key),
  FOREIGN KEY (disbursement_id,organization_id)
    REFERENCES public.customer_mandate_disbursements(id,organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_mandate_disbursements_customer_idx
  ON public.customer_mandate_disbursements(organization_id,customer_id,disbursed_at DESC);
CREATE INDEX IF NOT EXISTS customer_mandate_reimbursements_disbursement_idx
  ON public.customer_mandate_reimbursements(organization_id,disbursement_id);

ALTER TABLE public.customer_mandate_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_mandate_reimbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements FROM PUBLIC,anon;
CREATE POLICY customer_mandate_disbursements_org_read ON public.customer_mandate_disbursements
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'suppliers.view'));
CREATE POLICY customer_mandate_reimbursements_org_read ON public.customer_mandate_reimbursements
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'suppliers.view'));
GRANT SELECT ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements TO authenticated;
GRANT ALL ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements TO service_role;

INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('467','Autres comptes débiteurs ou créditeurs','asset')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_customer_mandate_disbursement(
  p_org uuid,p_purchase_order_line uuid,p_supplier_document_reference text,p_document_date date,
  p_amount numeric,p_account uuid,p_disbursed_at date,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_line public.purchase_order_lines%rowtype;
  v_order public.purchase_orders%rowtype;
  v_account public.financial_accounts%rowtype;
  v_id uuid;
  v_existing public.customer_mandate_disbursements%rowtype;
  v_expected numeric(18,2);
  v_previously_disbursed numeric(18,2):=0;
  v_ref text;
  v_entry uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_request_key IS NULL OR p_amount<=0 OR nullif(trim(coalesce(p_supplier_document_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Justificatif, montant et clé de demande obligatoires.';
  END IF;
  SELECT * INTO v_existing FROM public.customer_mandate_disbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.purchase_order_line_id=p_purchase_order_line
       AND v_existing.supplier_document_reference=trim(p_supplier_document_reference)
       AND v_existing.amount=p_amount AND v_existing.financial_account_id=p_account
       AND v_existing.disbursed_at=p_disbursed_at AND v_existing.document_date=p_document_date THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Clé de demande déjà utilisée pour un autre débours.';
  END IF;
  SELECT * INTO v_line FROM public.purchase_order_lines
   WHERE id=p_purchase_order_line AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande de mandat introuvable.'; END IF;
  SELECT * INTO v_existing FROM public.customer_mandate_disbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.purchase_order_line_id=p_purchase_order_line
       AND v_existing.supplier_document_reference=trim(p_supplier_document_reference)
       AND v_existing.amount=p_amount AND v_existing.financial_account_id=p_account
       AND v_existing.disbursed_at=p_disbursed_at AND v_existing.document_date=p_document_date THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Clé de demande déjà utilisée pour un autre débours.';
  END IF;
  IF v_line.purchase_purpose<>'customer_mandate'
     OR NOT v_line.mandate_confirmed OR NOT v_line.supplier_document_names_customer
     OR v_line.company_bears_goods_risk OR NOT v_line.exact_cost_supported
     OR nullif(trim(v_line.mandate_supplier_document_reference),'') IS NULL THEN
    RAISE EXCEPTION 'La ligne ne satisfait pas les conditions documentaires du mandat client.';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders
   WHERE id=v_line.purchase_order_id AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande de mandat introuvable.'; END IF;
  IF v_line.quantity_received<=0 OR v_line.quantity_ordered<=0 THEN
    RAISE EXCEPTION 'La ligne mandatée doit être réceptionnée avant son paiement.';
  END IF;
  v_expected:=round(
    round(v_line.quantity_received*v_line.unit_price,2)
    - round(v_line.discount_amount*v_line.quantity_received/v_line.quantity_ordered,2)
    + round(v_line.additional_cost_amount*v_line.quantity_received/v_line.quantity_ordered,2)
    + round((round(v_line.quantity_received*v_line.unit_price,2)
      - round(v_line.discount_amount*v_line.quantity_received/v_line.quantity_ordered,2)
      + round(v_line.additional_cost_amount*v_line.quantity_received/v_line.quantity_ordered,2))
      *v_line.tax_rate/100,2),2);
  IF abs(v_expected-p_amount)>0.01 THEN
    RAISE EXCEPTION 'Le débours doit correspondre au coût exact proratisé de la quantité mandatée réceptionnée (%).',v_expected;
  END IF;
  IF v_line.mandate_supplier_document_reference<>trim(p_supplier_document_reference) THEN
    RAISE EXCEPTION 'La référence de la pièce fournisseur doit correspondre à celle du mandat validé.';
  END IF;
  SELECT coalesce(sum(amount),0) INTO v_previously_disbursed
    FROM public.customer_mandate_disbursements
   WHERE organization_id=p_org AND purchase_order_line_id=p_purchase_order_line
     AND supplier_document_reference=trim(p_supplier_document_reference);
  IF p_amount>v_expected-v_previously_disbursed+0.00000001 THEN
    RAISE EXCEPTION 'Le paiement dépasse le coût exact restant à régler pour cette pièce fournisseur.';
  END IF;
  SELECT * INTO v_account FROM public.financial_accounts
   WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier inactif ou introuvable.'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_disbursed_at);
  v_ref:='MANDAT-'||upper(substr(replace(p_request_key::text,'-',''),1,12));
  INSERT INTO public.customer_mandate_disbursements(
    organization_id,purchase_order_line_id,customer_id,supplier_id,supplier_document_reference,
    document_date,amount,financial_account_id,disbursed_at,created_by,request_key
  ) VALUES(
    p_org,v_line.id,v_line.beneficiary_customer_id,v_order.supplier_id,trim(p_supplier_document_reference),
    p_document_date,p_amount,p_account,p_disbursed_at,auth.uid(),p_request_key
  ) RETURNING id INTO v_id;
  UPDATE public.financial_accounts SET balance=balance-p_amount,updated_at=now() WHERE id=p_account;
  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  ) VALUES(p_org,p_account,p_disbursed_at,-p_amount,'expense','customer_mandate_disbursement',v_id,v_ref,
    'Avance fournisseur pour mandat client');
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code','467','debit',p_amount,'credit',0,'customer_id',v_line.beneficiary_customer_id),
    jsonb_build_object('account_kind','treasury','financial_account_id',p_account::text,'account_label',v_account.name,'debit',0,'credit',p_amount)
  );
  v_entry:=public.magnisa_post_journal(p_org,p_disbursed_at,v_ref,'Débours fournisseur pour mandat client','customer_mandate_disbursement',v_id,v_lines);
  PERFORM public.audit_event(p_org,'customer_mandate.disbursed','customer_mandate_disbursement',v_id,NULL,
    jsonb_build_object('customer_id',v_line.beneficiary_customer_id,'supplier_id',v_order.supplier_id,
      'amount',p_amount,'journal_entry_id',v_entry,'purchase_order_line_id',v_line.id));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_customer_mandate_disbursement(uuid,uuid,text,date,numeric,uuid,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_mandate_disbursement(uuid,uuid,text,date,numeric,uuid,date,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_mandate_reimbursement(
  p_org uuid,p_disbursement uuid,p_account uuid,p_amount numeric,p_date date,p_reference text,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_disbursement public.customer_mandate_disbursements%rowtype;
  v_existing public.customer_mandate_reimbursements%rowtype;
  v_account public.financial_accounts%rowtype;
  v_reimbursed numeric(18,2);
  v_id uuid;
  v_ref text;
  v_entry uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'payments.record');
  IF p_request_key IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Montant et clé de demande obligatoires.'; END IF;
  SELECT * INTO v_existing FROM public.customer_mandate_reimbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.disbursement_id=p_disbursement AND v_existing.financial_account_id=p_account
       AND v_existing.amount=p_amount AND v_existing.reimbursement_date=p_date
       AND coalesce(v_existing.reference,'')=coalesce(nullif(trim(p_reference),''),'REMB-MANDAT-'||upper(substr(replace(p_request_key::text,'-',''),1,12))) THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Clé de demande déjà utilisée pour un autre remboursement.';
  END IF;
  SELECT * INTO v_disbursement FROM public.customer_mandate_disbursements
   WHERE id=p_disbursement AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Débours de mandat introuvable.'; END IF;
  SELECT * INTO v_existing FROM public.customer_mandate_reimbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.disbursement_id=p_disbursement AND v_existing.financial_account_id=p_account
       AND v_existing.amount=p_amount AND v_existing.reimbursement_date=p_date
       AND coalesce(v_existing.reference,'')=coalesce(nullif(trim(p_reference),''),'REMB-MANDAT-'||upper(substr(replace(p_request_key::text,'-',''),1,12))) THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Clé de demande déjà utilisée pour un autre remboursement.';
  END IF;
  SELECT coalesce(sum(amount),0) INTO v_reimbursed FROM public.customer_mandate_reimbursements
   WHERE organization_id=p_org AND disbursement_id=p_disbursement;
  IF p_amount>v_disbursement.amount-v_reimbursed+0.00000001 THEN
    RAISE EXCEPTION 'Le remboursement dépasse le solde dû par le client.';
  END IF;
  SELECT * INTO v_account FROM public.financial_accounts
   WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier inactif ou introuvable.'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  v_ref:=coalesce(nullif(trim(p_reference),''),'REMB-MANDAT-'||upper(substr(replace(p_request_key::text,'-',''),1,12)));
  INSERT INTO public.customer_mandate_reimbursements(
    organization_id,disbursement_id,financial_account_id,amount,reimbursement_date,reference,request_key,created_by
  ) VALUES(p_org,p_disbursement,p_account,p_amount,p_date,v_ref,p_request_key,auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.financial_accounts SET balance=balance+p_amount,updated_at=now() WHERE id=p_account;
  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  ) VALUES(p_org,p_account,p_date,p_amount,'income','customer_mandate_reimbursement',v_id,v_ref,
    'Remboursement débours de mandat client');
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','treasury','financial_account_id',p_account::text,'account_label',v_account.name,'debit',p_amount,'credit',0,'customer_id',v_disbursement.customer_id),
    jsonb_build_object('account_kind','pcg','pcg_code','467','debit',0,'credit',p_amount,'customer_id',v_disbursement.customer_id)
  );
  v_entry:=public.magnisa_post_journal(p_org,p_date,v_ref,'Remboursement de débours de mandat client','customer_mandate_reimbursement',v_id,v_lines);
  PERFORM public.audit_event(p_org,'customer_mandate.reimbursed','customer_mandate_reimbursement',v_id,NULL,
    jsonb_build_object('disbursement_id',p_disbursement,'customer_id',v_disbursement.customer_id,
      'amount',p_amount,'journal_entry_id',v_entry));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_customer_mandate_reimbursement(uuid,uuid,uuid,numeric,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_mandate_reimbursement(uuid,uuid,uuid,numeric,date,text,uuid) TO authenticated;
