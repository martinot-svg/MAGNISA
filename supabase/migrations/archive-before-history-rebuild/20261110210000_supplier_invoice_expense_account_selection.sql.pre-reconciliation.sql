-- Explicit supplier invoice PCG expense mapping.
-- The user must select the expense account; no blanket 606 classification is inferred.
INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('607','Achats de marchandises','expense')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS expense_account_code text
  REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT;

REVOKE ALL ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_supplier_invoice_with_tax(
  p_org uuid,p_supplier uuid,p_supplier_number text,p_invoice_date date,p_due_date date,
  p_subtotal numeric,p_tax_total numeric,p_tax_treatment text,p_tax_document_reference text,
  p_notes text,p_reconciliation_scope text,p_expense_account_code text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_invoice uuid; v_entry uuid; v_supplier_name text; v_existing public.supplier_invoices%rowtype;
  v_ref text; v_total numeric(18,2); v_expense_code text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_subtotal IS NULL OR p_subtotal<=0 OR p_tax_total IS NULL OR p_tax_total<0 THEN
    RAISE EXCEPTION 'Le sous-total et la TVA de la facture sont invalides.';
  END IF;
  IF p_tax_treatment IS NULL OR p_tax_treatment NOT IN ('not_applicable','recoverable','nonrecoverable') THEN
    RAISE EXCEPTION 'Traitement de TVA invalide.';
  END IF;
  IF p_tax_treatment='not_applicable' AND p_tax_total<>0 THEN
    RAISE EXCEPTION 'Une facture sans TVA ne peut pas contenir de montant de TVA.';
  END IF;
  IF p_tax_total>0 AND nullif(trim(coalesce(p_tax_document_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'La référence du justificatif fiscal est obligatoire dès qu’une TVA est facturée.';
  END IF;
  IF p_reconciliation_scope IS NULL OR p_reconciliation_scope NOT IN ('goods_procurement','service_or_other') THEN
    RAISE EXCEPTION 'Nature de facture fournisseur invalide.';
  END IF;
  SELECT code INTO v_expense_code FROM public.pcg2005_accounts
   WHERE code=trim(coalesce(p_expense_account_code,'')) AND kind='expense';
  IF v_expense_code IS NULL THEN RAISE EXCEPTION 'Sélectionne un compte de charge PCG valide.'; END IF;
  IF p_invoice_date IS NULL OR (p_due_date IS NOT NULL AND p_due_date<p_invoice_date) THEN
    RAISE EXCEPTION 'Date ou échéance de facture invalide.';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_invoice_date);
  v_total:=round(p_subtotal+p_tax_total,2);
  IF v_total<=0 THEN RAISE EXCEPTION 'Le total de la facture doit être positif.'; END IF;
  v_ref:=nullif(trim(coalesce(p_supplier_number,'')),'');
  IF v_ref IS NULL THEN RAISE EXCEPTION 'Numéro de facture fournisseur requis.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_supplier::text||':'||v_ref,0));
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
       AND coalesce(v_existing.notes,'')=coalesce(nullif(trim(p_notes),''),'')
       AND v_existing.reconciliation_scope=p_reconciliation_scope
       AND v_existing.expense_account_code=v_expense_code AND v_existing.status<>'cancelled' THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'Ce numéro de facture fournisseur existe déjà avec des données différentes.';
  END IF;

  INSERT INTO public.supplier_invoices(
    organization_id,supplier_id,supplier_number,invoice_date,due_date,subtotal,tax_total,total,
    paid_amount,balance_due,status,notes,created_by,reconciliation_scope,tax_treatment,
    tax_document_reference,expense_account_code
  ) VALUES(
    p_org,p_supplier,v_ref,p_invoice_date,p_due_date,round(p_subtotal,2),round(p_tax_total,2),v_total,
    0,v_total,'validated',nullif(trim(coalesce(p_notes,'')),''),auth.uid(),
    p_reconciliation_scope,p_tax_treatment,nullif(trim(p_tax_document_reference),''),v_expense_code
  ) RETURNING id INTO v_invoice;

  INSERT INTO public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  ) VALUES(p_org,p_invoice_date,'FOUR-'||v_ref,'Facture fournisseur '||v_supplier_name||' — '||v_ref,
    'supplier_invoice',v_invoice,v_total,v_total) RETURNING id INTO v_entry;

  IF p_tax_treatment='recoverable' THEN
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    VALUES
      (p_org,v_entry,'EXPENSE:SUPPLIER','Achats et charges fournisseurs',round(p_subtotal,2),0),
      (p_org,v_entry,'TAX:SUPPLIER_INPUT','TVA déductible sur factures fournisseurs',round(p_tax_total,2),0),
      (p_org,v_entry,'AP','Dettes fournisseurs',0,v_total);
    INSERT INTO public.pcg2005_supplier_invoice_mappings(
      organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment
    ) VALUES(p_org,v_invoice,'TAX:SUPPLIER_INPUT','4456',
      'TVA déclarée déductible sur facture fournisseur ; la pièce justificative originale doit être archivée.',
      'record_only',true)
    ON CONFLICT(organization_id,supplier_invoice_id,account_key) DO NOTHING;
  ELSE
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    VALUES
      (p_org,v_entry,'EXPENSE:SUPPLIER','Achats et charges fournisseurs',v_total,0),
      (p_org,v_entry,'AP','Dettes fournisseurs',0,v_total);
  END IF;

  INSERT INTO public.pcg2005_supplier_invoice_mappings(
    organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment
  ) VALUES(p_org,v_invoice,'EXPENSE:SUPPLIER',v_expense_code,
    'Compte de charge PCG explicitement sélectionné et conservé avec la facture fournisseur.',
    'pending',true)
  ON CONFLICT(organization_id,supplier_invoice_id,account_key) DO NOTHING;

  PERFORM public.audit_event(p_org,'supplier_invoice.validated','supplier_invoice',v_invoice,NULL,
    jsonb_build_object('supplier_id',p_supplier,'supplier_number',v_ref,'subtotal',p_subtotal,
      'tax_total',p_tax_total,'total',v_total,'tax_treatment',p_tax_treatment,
      'reconciliation_scope',p_reconciliation_scope,'expense_account_code',v_expense_code,
      'tax_document_reference',p_tax_document_reference,'journal_entry_id',v_entry));
  RETURN v_invoice;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text,text) TO authenticated;
