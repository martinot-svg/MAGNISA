-- Complete supplier invoice tax posting, multi-order matching and customer-mandate settlement.
-- Additive, tenant-scoped, idempotent and forward-only. Never apply to Production without release approval.

-- PCG 2005 accounts used by these explicit posting flows.
INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES
 ('37','Stocks de marchandises','asset'),
 ('401','Fournisseurs de biens et services','liability'),
 ('4456','État, TVA déductible','asset'),
 ('467','Autres comptes débiteurs ou créditeurs','asset'),
 ('606','Achats non stockés de matières et fournitures','expense')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS tax_document_reference text;

DO $tax_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_tax_treatment_check') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_tax_treatment_check
      CHECK (tax_treatment IN ('not_applicable','recoverable','nonrecoverable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.supplier_invoices'::regclass AND conname='supplier_invoices_totals_consistency_check') THEN
    ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_totals_consistency_check
      CHECK (total=round(subtotal+tax_total,2) AND subtotal>=0 AND tax_total>=0);
  END IF;
END
$tax_constraints$;

-- The legacy gross-only endpoint cannot be used by authenticated users anymore.
REVOKE ALL ON FUNCTION public.record_supplier_invoice(uuid,uuid,text,date,date,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_invoice(uuid,uuid,text,date,date,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_supplier_invoice_with_tax(
  p_org uuid,p_supplier uuid,p_supplier_number text,p_invoice_date date,p_due_date date,
  p_subtotal numeric,p_tax_total numeric,p_tax_treatment text,p_tax_document_reference text,
  p_notes text,p_reconciliation_scope text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice uuid;
  v_supplier_name text;
  v_total numeric(18,2);
  v_cost_account text;
  v_cost_amount numeric(18,2);
  v_lines jsonb;
  v_journal uuid;
  v_reference text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_subtotal IS NULL OR p_subtotal<=0 OR p_tax_total IS NULL OR p_tax_total<0 THEN
    RAISE EXCEPTION 'Le sous-total HT doit être positif et la TVA ne peut pas être négative.';
  END IF;
  IF p_invoice_date IS NULL OR (p_due_date IS NOT NULL AND p_due_date<p_invoice_date) THEN
    RAISE EXCEPTION 'Dates de facture ou d’échéance invalides.';
  END IF;
  IF p_tax_treatment NOT IN ('not_applicable','recoverable','nonrecoverable') THEN
    RAISE EXCEPTION 'Traitement de TVA invalide.';
  END IF;
  IF p_tax_treatment='not_applicable' AND p_tax_total<>0 THEN
    RAISE EXCEPTION 'Une facture sans TVA ne peut pas contenir de montant de TVA.';
  END IF;
  IF p_tax_total>0 AND nullif(trim(coalesce(p_tax_document_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'La référence du justificatif fiscal est obligatoire dès qu’une TVA est facturée.';
  END IF;
  IF p_reconciliation_scope NOT IN ('goods_procurement','service_or_other') THEN
    RAISE EXCEPTION 'Nature de facture fournisseur invalide.';
  END IF;
  v_reference:=nullif(trim(coalesce(p_supplier_number,'')),'');
  IF v_reference IS NULL THEN RAISE EXCEPTION 'Numéro de facture fournisseur obligatoire.'; END IF;
  v_total:=round(p_subtotal+p_tax_total,2);
  SELECT name INTO v_supplier_name FROM public.suppliers
   WHERE id=p_supplier AND organization_id=p_org AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur introuvable ou inactif.'; END IF;
  IF EXISTS(SELECT 1 FROM public.supplier_invoices WHERE organization_id=p_org AND supplier_id=p_supplier AND supplier_number=v_reference) THEN
    RAISE EXCEPTION 'Ce numéro de facture existe déjà pour ce fournisseur.';
  END IF;

  v_cost_account:=CASE WHEN p_reconciliation_scope='goods_procurement' THEN '37' ELSE '606' END;
  v_cost_amount:=CASE WHEN p_tax_treatment='recoverable' THEN p_subtotal ELSE v_total END;

  INSERT INTO public.supplier_invoices(
    organization_id,supplier_id,supplier_number,invoice_date,due_date,subtotal,tax_total,total,
    paid_amount,balance_due,status,notes,created_by,tax_treatment,tax_document_reference,reconciliation_scope
  ) VALUES(
    p_org,p_supplier,v_reference,p_invoice_date,p_due_date,p_subtotal,p_tax_total,v_total,
    0,v_total,'validated',nullif(trim(coalesce(p_notes,'')),''),auth.uid(),p_tax_treatment,
    nullif(trim(coalesce(p_tax_document_reference,'')),''),p_reconciliation_scope
  ) RETURNING id INTO v_invoice;

  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',v_cost_account,'debit',v_cost_amount,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code','401','debit',0,'credit',v_total)
  );
  IF p_tax_treatment='recoverable' AND p_tax_total>0 THEN
    v_lines:=jsonb_build_array(
      jsonb_build_object('account_kind','pcg','pcg_code',v_cost_account,'debit',p_subtotal,'credit',0),
      jsonb_build_object('account_kind','pcg','pcg_code','4456','debit',p_tax_total,'credit',0),
      jsonb_build_object('account_kind','pcg','pcg_code','401','debit',0,'credit',v_total)
    );
  END IF;
  v_journal:=public.magnisa_post_journal(
    p_org,p_invoice_date,'FOUR-'||v_reference,
    'Facture fournisseur '||v_supplier_name||' - '||v_reference,
    'supplier_invoice',v_invoice,v_lines
  );

  IF to_regclass('public.pcg2005_supplier_invoice_mappings') IS NOT NULL THEN
    INSERT INTO public.pcg2005_supplier_invoice_mappings(
      organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment
    ) VALUES(
      p_org,v_invoice,'EXPENSE:SUPPLIER',v_cost_account,
      'Imputation fournisseur créée à partir de la nature déclarée de la facture ; justificatif conservé dans la fiche fournisseur.',
      CASE WHEN nullif(trim(coalesce(p_tax_document_reference,'')),'') IS NULL THEN 'pending' ELSE 'documented' END,
      true
    ) ON CONFLICT(organization_id,supplier_invoice_id,account_key) DO NOTHING;
  END IF;
  PERFORM public.audit_event(p_org,'supplier_invoice.validated','supplier_invoice',v_invoice,NULL,
    jsonb_build_object('supplier_id',p_supplier,'supplier_number',v_reference,'subtotal',p_subtotal,
      'tax_total',p_tax_total,'total',v_total,'tax_treatment',p_tax_treatment,
      'tax_document_reference',p_tax_document_reference,'cost_account',v_cost_account,'journal_entry_id',v_journal));
  RETURN v_invoice;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text) TO authenticated;

-- Replace the single-order uniqueness with invoice/order uniqueness.
ALTER TABLE public.supplier_invoice_matches
  DROP CONSTRAINT IF EXISTS supplier_invoice_matches_organization_id_supplier_invoice_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_matches_invoice_order_uidx
  ON public.supplier_invoice_matches(organization_id,supplier_invoice_id,purchase_order_id);

CREATE OR REPLACE FUNCTION public.reconcile_supplier_invoice_multi_order(
  p_org uuid,p_supplier_invoice uuid,p_allocations jsonb,p_variance_reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice public.supplier_invoices%rowtype;
  v_order public.purchase_orders%rowtype;
  v_receipt_line public.goods_receipt_lines%rowtype;
  v_receipt public.goods_receipts%rowtype;
  v_order_line public.purchase_order_lines%rowtype;
  v_allocation jsonb;
  v_order_id uuid;
  v_match uuid;
  v_qty numeric(18,4);
  v_price numeric(18,2);
  v_order_subtotal numeric(18,2);
  v_total_subtotal numeric(18,2):=0;
  v_previously_matched numeric(18,4);
  v_variance boolean;
  v_match_count integer:=0;
  v_line_count integer:=0;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations)<>'array'
     OR jsonb_array_length(p_allocations)<1 OR jsonb_array_length(p_allocations)>200 THEN
    RAISE EXCEPTION 'Le rapprochement doit contenir entre 1 et 200 lignes.';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_allocations) x
    GROUP BY x->>'goods_receipt_line_id' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Une même ligne de réception ne peut apparaître deux fois.'; END IF;

  SELECT * INTO v_invoice FROM public.supplier_invoices
   WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('draft','cancelled') OR v_invoice.reconciliation_scope<>'goods_procurement' THEN
    RAISE EXCEPTION 'Facture fournisseur absente, non validée ou hors achats de marchandises.';
  END IF;
  IF abs(v_invoice.total-v_invoice.subtotal-v_invoice.tax_total)>0.01 OR v_invoice.subtotal<=0 THEN
    RAISE EXCEPTION 'Les totaux HT, TVA et TTC de la facture sont incohérents.';
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT gr.purchase_order_id
    FROM jsonb_array_elements(p_allocations) a
    JOIN public.goods_receipt_lines grl ON grl.id=(a->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
    JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
    ORDER BY gr.purchase_order_id
  LOOP
    SELECT * INTO v_order FROM public.purchase_orders
     WHERE id=v_order_id AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND OR v_order.supplier_id<>v_invoice.supplier_id
       OR v_order.status NOT IN ('submitted','partially_received','received') THEN
      RAISE EXCEPTION 'Toutes les commandes doivent appartenir au fournisseur de la facture et être soumises.';
    END IF;
    IF EXISTS(SELECT 1 FROM public.supplier_invoice_matches
      WHERE organization_id=p_org AND supplier_invoice_id=v_invoice.id AND purchase_order_id=v_order.id) THEN
      RAISE EXCEPTION 'Cette facture possède déjà un rapprochement avec la commande %.',v_order.number;
    END IF;

    v_order_subtotal:=0;
    v_variance:=false;
    FOR v_allocation IN
      SELECT a FROM jsonb_array_elements(p_allocations) a
      JOIN public.goods_receipt_lines grl ON grl.id=(a->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
      JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
      WHERE gr.purchase_order_id=v_order.id
    LOOP
      IF nullif(v_allocation->>'quantity','') IS NULL OR nullif(v_allocation->>'unit_price','') IS NULL THEN
        RAISE EXCEPTION 'Chaque allocation doit préciser une quantité et un prix unitaire.';
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
        RAISE EXCEPTION 'Seules les réceptions validées de chaque commande sont rapprochables.';
      END IF;
      SELECT * INTO v_order_line FROM public.purchase_order_lines
       WHERE id=v_receipt_line.purchase_order_line_id AND organization_id=p_org;
      IF NOT FOUND OR v_order_line.purchase_purpose='customer_mandate' THEN
        RAISE EXCEPTION 'Les achats sous mandat client sont exclus du rapprochement de stock de l’entreprise.';
      END IF;
      SELECT coalesce(sum(ml.quantity_invoiced),0) INTO v_previously_matched
      FROM public.supplier_invoice_match_lines ml
      JOIN public.supplier_invoice_matches m ON m.id=ml.match_id AND m.organization_id=ml.organization_id
      WHERE ml.organization_id=p_org AND ml.goods_receipt_line_id=v_receipt_line.id;
      IF v_qty>v_receipt_line.quantity_received-v_previously_matched+0.00000001 THEN
        RAISE EXCEPTION 'La quantité facturée dépasse la quantité reçue encore non rapprochée.';
      END IF;
      IF abs(v_price-v_order_line.unit_price)>0.01 THEN v_variance:=true; END IF;
      v_order_subtotal:=v_order_subtotal+round(v_qty*v_price,2);
      v_line_count:=v_line_count+1;
    END LOOP;

    INSERT INTO public.supplier_invoice_matches(
      organization_id,supplier_invoice_id,purchase_order_id,match_status,variance_reason,matched_by
    ) VALUES(
      p_org,v_invoice.id,v_order.id,
      CASE WHEN v_variance THEN 'matched_with_variance' ELSE 'matched' END,
      CASE WHEN v_variance THEN nullif(trim(coalesce(p_variance_reason,'')),'') ELSE NULL END,
      auth.uid()
    ) RETURNING id INTO v_match;

    FOR v_allocation IN
      SELECT a FROM jsonb_array_elements(p_allocations) a
      JOIN public.goods_receipt_lines grl ON grl.id=(a->>'goods_receipt_line_id')::uuid AND grl.organization_id=p_org
      JOIN public.goods_receipts gr ON gr.id=grl.goods_receipt_id AND gr.organization_id=p_org
      WHERE gr.purchase_order_id=v_order.id
    LOOP
      v_qty:=(v_allocation->>'quantity')::numeric;
      v_price:=(v_allocation->>'unit_price')::numeric;
      INSERT INTO public.supplier_invoice_match_lines(
        organization_id,match_id,goods_receipt_line_id,quantity_invoiced,invoiced_unit_price,line_subtotal
      ) VALUES(p_org,v_match,(v_allocation->>'goods_receipt_line_id')::uuid,v_qty,v_price,round(v_qty*v_price,2));
    END LOOP;
    IF v_variance AND nullif(trim(coalesce(p_variance_reason,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Un écart de prix doit être justifié pour chaque facture rapprochée.';
    END IF;
    v_total_subtotal:=v_total_subtotal+v_order_subtotal;
    v_match_count:=v_match_count+1;
    PERFORM public.audit_event(p_org,'supplier_invoice.reconciled','supplier_invoice',v_invoice.id,NULL,
      jsonb_build_object('purchase_order_id',v_order.id,'match_id',v_match,'matched_subtotal',v_order_subtotal,
        'variance',v_variance,'variance_reason',p_variance_reason));
  END LOOP;

  IF v_match_count=0 OR abs(v_total_subtotal-v_invoice.subtotal)>0.01 THEN
    RAISE EXCEPTION 'Le total HT rapproché (%) doit être égal au sous-total HT de la facture (%).',
      v_total_subtotal,v_invoice.subtotal;
  END IF;
  RETURN v_match_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE VIEW public.magnisa_supplier_invoice_match_reconciliation
WITH (security_invoker=true) AS
SELECT si.organization_id,si.id supplier_invoice_id,si.supplier_number,si.supplier_id,si.total invoice_total,
       CASE WHEN count(m.id)=0 THEN 'unmatched'
            WHEN bool_or(m.match_status='matched_with_variance') THEN 'matched_with_variance'
            ELSE 'matched' END match_status,
       NULL::uuid purchase_order_id,
       string_agg(DISTINCT po.number,', ' ORDER BY po.number) purchase_order_number,
       coalesce(sum(ml.line_subtotal),0)::numeric(18,2) matched_subtotal,
       (si.subtotal-coalesce(sum(ml.line_subtotal),0))::numeric(18,2) unmatched_subtotal,
       string_agg(DISTINCT m.variance_reason,'; ') FILTER(WHERE m.variance_reason IS NOT NULL) variance_reason,
       max(m.matched_at) matched_at
FROM public.supplier_invoices si
LEFT JOIN public.supplier_invoice_matches m ON m.supplier_invoice_id=si.id AND m.organization_id=si.organization_id
LEFT JOIN public.purchase_orders po ON po.id=m.purchase_order_id AND po.organization_id=m.organization_id
LEFT JOIN public.supplier_invoice_match_lines ml ON ml.match_id=m.id AND ml.organization_id=m.organization_id
WHERE si.reconciliation_scope='goods_procurement'
GROUP BY si.organization_id,si.id,si.supplier_number,si.supplier_id,si.total,si.subtotal;
REVOKE ALL ON public.magnisa_supplier_invoice_match_reconciliation FROM PUBLIC,anon;
GRANT SELECT ON public.magnisa_supplier_invoice_match_reconciliation TO authenticated;

-- Customer mandate disbursements are third-party funds advanced by the company.
-- Account 467 tracks the receivable from the named customer, not an operating expense.
INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('467','Autres comptes débiteurs ou créditeurs','asset')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.customer_mandate_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_document_reference text NOT NULL,
  document_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK(amount>0),
  financial_account_id uuid NOT NULL,
  disbursed_at date NOT NULL,
  request_key uuid NOT NULL,
  request_digest text NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_key),
  UNIQUE(id,organization_id),
  FOREIGN KEY(purchase_order_line_id,organization_id) REFERENCES public.purchase_order_lines(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(customer_id,organization_id) REFERENCES public.customers(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(supplier_id,organization_id) REFERENCES public.suppliers(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(financial_account_id,organization_id) REFERENCES public.financial_accounts(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.customer_mandate_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  disbursement_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  financial_account_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK(amount>0),
  reimbursement_date date NOT NULL,
  reference text,
  request_key uuid NOT NULL,
  request_digest text NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_key),
  FOREIGN KEY(disbursement_id,organization_id) REFERENCES public.customer_mandate_disbursements(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(customer_id,organization_id) REFERENCES public.customers(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(financial_account_id,organization_id) REFERENCES public.financial_accounts(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS customer_mandate_disbursements_line_idx
  ON public.customer_mandate_disbursements(organization_id,purchase_order_line_id);
CREATE INDEX IF NOT EXISTS customer_mandate_reimbursements_disbursement_idx
  ON public.customer_mandate_reimbursements(organization_id,disbursement_id);

ALTER TABLE public.customer_mandate_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_mandate_reimbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements FROM PUBLIC,anon,authenticated;
CREATE POLICY customer_mandate_disbursements_select ON public.customer_mandate_disbursements
  FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
CREATE POLICY customer_mandate_reimbursements_select ON public.customer_mandate_reimbursements
  FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
GRANT SELECT ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements TO authenticated;
GRANT ALL ON public.customer_mandate_disbursements,public.customer_mandate_reimbursements TO service_role;

CREATE OR REPLACE FUNCTION public.record_customer_mandate_disbursement(
  p_org uuid,p_purchase_order_line uuid,p_supplier_document_reference text,p_document_date date,
  p_amount numeric,p_account uuid,p_disbursed_at date,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_line public.purchase_order_lines%rowtype;
  v_order public.purchase_orders%rowtype;
  v_account public.financial_accounts%rowtype;
  v_customer uuid;
  v_supplier uuid;
  v_expected numeric(18,2);
  v_paid numeric(18,2);
  v_id uuid;
  v_existing public.customer_mandate_disbursements%rowtype;
  v_digest text;
  v_journal uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_request_key IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_document_date IS NULL OR p_disbursed_at IS NULL THEN
    RAISE EXCEPTION 'Données du débours mandaté invalides.';
  END IF;
  v_digest:=md5(jsonb_build_array(p_purchase_order_line,p_supplier_document_reference,p_document_date,p_amount,p_account,p_disbursed_at)::text);
  SELECT * INTO v_existing FROM public.customer_mandate_disbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé idempotente réutilisée avec des données différentes.'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_line FROM public.purchase_order_lines
   WHERE id=p_purchase_order_line AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_line.purchase_purpose<>'customer_mandate' OR v_line.quantity_received<=0
     OR NOT v_line.mandate_confirmed OR NOT v_line.supplier_document_names_customer
     OR v_line.company_bears_goods_risk OR NOT v_line.exact_cost_supported
     OR nullif(trim(coalesce(v_line.mandate_supplier_document_reference,'')),'') IS NULL
     OR trim(p_supplier_document_reference)<>trim(v_line.mandate_supplier_document_reference) THEN
    RAISE EXCEPTION 'Le mandat, le justificatif fournisseur au nom du client et le coût exact doivent être validés.';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders
   WHERE id=v_line.purchase_order_id AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commande fournisseur introuvable.'; END IF;
  v_customer:=v_line.beneficiary_customer_id;
  v_supplier:=v_order.supplier_id;
  v_expected:=round(
    (v_line.quantity_received*v_line.unit_price
     -v_line.discount_amount*v_line.quantity_received/nullif(v_line.quantity_ordered,0)
     +v_line.additional_cost_amount*v_line.quantity_received/nullif(v_line.quantity_ordered,0))
    *(1+v_line.tax_rate/100),2
  );
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.customer_mandate_disbursements
   WHERE organization_id=p_org AND purchase_order_line_id=v_line.id;
  IF p_amount>v_expected-v_paid+0.01 THEN
    RAISE EXCEPTION 'Le débours dépasse le coût mandaté restant justifié (%).',greatest(v_expected-v_paid,0);
  END IF;
  SELECT * INTO v_account FROM public.financial_accounts
   WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND OR v_account.balance<p_amount THEN RAISE EXCEPTION 'Compte financier inactif ou solde insuffisant.'; END IF;

  INSERT INTO public.customer_mandate_disbursements(
    organization_id,purchase_order_line_id,customer_id,supplier_id,supplier_document_reference,
    document_date,amount,financial_account_id,disbursed_at,request_key,request_digest,created_by
  ) VALUES(p_org,v_line.id,v_customer,v_supplier,trim(p_supplier_document_reference),
    p_document_date,p_amount,v_account.id,p_disbursed_at,p_request_key,v_digest,auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.financial_accounts SET balance=balance-p_amount,updated_at=now()
   WHERE id=v_account.id AND organization_id=p_org;
  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  ) VALUES(p_org,v_account.id,p_disbursed_at,-p_amount,'expense','customer_mandate_disbursement',v_id,
    trim(p_supplier_document_reference),'Débours pour compte de '||(SELECT name FROM public.customers WHERE id=v_customer));
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code','467','debit',p_amount,'credit',0,'customer_id',v_customer),
    jsonb_build_object('account_kind','treasury','financial_account_id',v_account.id::text,'account_label',v_account.name,'debit',0,'credit',p_amount)
  );
  v_journal:=public.magnisa_post_journal(p_org,p_disbursed_at,'MANDAT-DEP-'||left(v_id::text,12),
    'Débours client - '||(SELECT name FROM public.customers WHERE id=v_customer),
    'customer_mandate_disbursement',v_id,v_lines);
  UPDATE public.customer_mandate_disbursements SET journal_entry_id=v_journal WHERE id=v_id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'customer_mandate.disbursed','customer_mandate_disbursement',v_id,NULL,
    jsonb_build_object('customer_id',v_customer,'supplier_id',v_supplier,'amount',p_amount,'journal_entry_id',v_journal));
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
  v_account public.financial_accounts%rowtype;
  v_reimbursed numeric(18,2);
  v_id uuid;
  v_existing public.customer_mandate_reimbursements%rowtype;
  v_digest text;
  v_journal uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'payments.record');
  IF p_request_key IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_date IS NULL THEN
    RAISE EXCEPTION 'Données du remboursement mandaté invalides.';
  END IF;
  v_digest:=md5(jsonb_build_array(p_disbursement,p_account,p_amount,p_date,p_reference)::text);
  SELECT * INTO v_existing FROM public.customer_mandate_reimbursements
   WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé idempotente réutilisée avec des données différentes.'; END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_disbursement FROM public.customer_mandate_disbursements
   WHERE id=p_disbursement AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Débours client introuvable.'; END IF;
  SELECT coalesce(sum(amount),0) INTO v_reimbursed FROM public.customer_mandate_reimbursements
   WHERE organization_id=p_org AND disbursement_id=v_disbursement.id;
  IF p_amount>v_disbursement.amount-v_reimbursed+0.01 THEN
    RAISE EXCEPTION 'Le remboursement dépasse le solde du débours client (%).',greatest(v_disbursement.amount-v_reimbursed,0);
  END IF;
  SELECT * INTO v_account FROM public.financial_accounts
   WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier inactif ou invalide.'; END IF;

  INSERT INTO public.customer_mandate_reimbursements(
    organization_id,disbursement_id,customer_id,financial_account_id,amount,reimbursement_date,
    reference,request_key,request_digest,created_by
  ) VALUES(p_org,v_disbursement.id,v_disbursement.customer_id,v_account.id,p_amount,p_date,
    nullif(trim(coalesce(p_reference,'')),''),p_request_key,v_digest,auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.financial_accounts SET balance=balance+p_amount,updated_at=now()
   WHERE id=v_account.id AND organization_id=p_org;
  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  ) VALUES(p_org,v_account.id,p_date,p_amount,'customer_payment','customer_mandate_reimbursement',v_id,
    nullif(trim(coalesce(p_reference,'')),''),'Remboursement du débours client');
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','treasury','financial_account_id',v_account.id::text,'account_label',v_account.name,'debit',p_amount,'credit',0,'customer_id',v_disbursement.customer_id),
    jsonb_build_object('account_kind','pcg','pcg_code','467','debit',0,'credit',p_amount,'customer_id',v_disbursement.customer_id)
  );
  v_journal:=public.magnisa_post_journal(p_org,p_date,'MANDAT-REM-'||left(v_id::text,12),
    'Remboursement débours client','customer_mandate_reimbursement',v_id,v_lines);
  UPDATE public.customer_mandate_reimbursements SET journal_entry_id=v_journal WHERE id=v_id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'customer_mandate.reimbursed','customer_mandate_reimbursement',v_id,NULL,
    jsonb_build_object('disbursement_id',v_disbursement.id,'customer_id',v_disbursement.customer_id,
      'amount',p_amount,'journal_entry_id',v_journal));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_customer_mandate_reimbursement(uuid,uuid,uuid,numeric,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_mandate_reimbursement(uuid,uuid,uuid,numeric,date,text,uuid) TO authenticated;

