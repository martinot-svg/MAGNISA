-- MAGNISA accounting engine v2
-- Centralizes account resolution and journal validation for operational events.
-- PCG codes remain configuration data: no operational form is allowed to invent accounts.

CREATE TABLE IF NOT EXISTS public.accounting_posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  event_type text NOT NULL,
  operation_key text NOT NULL,
  debit_account_code text REFERENCES public.pcg2005_accounts(code),
  credit_account_code text REFERENCES public.pcg2005_accounts(code),
  fee_account_code text REFERENCES public.pcg2005_accounts(code),
  priority integer NOT NULL DEFAULT 100,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT accounting_posting_rules_dates_chk CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT accounting_posting_rules_type_chk CHECK (operation_type IN ('expense','customer_payment','supplier_payment','internal_transfer','transaction_fee','customer_refund','supplier_refund','advance')),
  CONSTRAINT accounting_posting_rules_event_chk CHECK (event_type IN ('recognition','settlement','fee','reversal','transfer'))
);

CREATE INDEX IF NOT EXISTS accounting_posting_rules_lookup_idx
  ON public.accounting_posting_rules(organization_id,operation_type,event_type,operation_key,active,priority);
ALTER TABLE public.accounting_posting_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_posting_rules_select ON public.accounting_posting_rules;
CREATE POLICY accounting_posting_rules_select ON public.accounting_posting_rules FOR SELECT TO authenticated USING (organization_id IS NULL OR public.assert_org_access_bool(organization_id));

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_nature text NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS document_reference text,
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_bearer text NOT NULL DEFAULT 'none';
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_expense_nature_chk;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_nature_chk CHECK (expense_nature IN ('expense','fixed_asset','advance','tax','social','other'));
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_fee_bearer_chk;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_fee_bearer_chk CHECK (fee_bearer IN ('company','client','shared','none'));
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_fee_amount_chk;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_fee_amount_chk CHECK (fee_amount >= 0);

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_bearer text NOT NULL DEFAULT 'none';
ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_fee_bearer_chk;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_fee_bearer_chk CHECK (fee_bearer IN ('company','client','shared','none'));
ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_fee_amount_chk;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_fee_amount_chk CHECK (fee_amount >= 0);

CREATE OR REPLACE FUNCTION public.magnisa_resolve_pcg_account(
  p_org uuid,
  p_operation_type text,
  p_event_type text,
  p_operation_key text,
  p_role text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_code text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  SELECT CASE p_role
    WHEN 'debit' THEN r.debit_account_code
    WHEN 'credit' THEN r.credit_account_code
    WHEN 'fee' THEN r.fee_account_code
    ELSE NULL END
  INTO v_code
  FROM public.accounting_posting_rules r
  WHERE r.operation_type=p_operation_type
    AND r.event_type=p_event_type
    AND r.operation_key=p_operation_key
    AND r.active
    AND r.valid_from<=current_date
    AND (r.valid_to IS NULL OR r.valid_to>=current_date)
    AND (r.organization_id=p_org OR r.organization_id IS NULL)
  ORDER BY CASE WHEN r.organization_id=p_org THEN 0 ELSE 1 END, r.priority, r.valid_from DESC
  LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Aucune règle comptable valide pour %, %, %',p_operation_type,p_event_type,p_operation_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_code) THEN
    RAISE EXCEPTION 'Le compte PCG % référencé par la règle n’existe plus',v_code;
  END IF;
  RETURN v_code;
END; $$;

CREATE OR REPLACE FUNCTION public.magnisa_post_journal(
  p_org uuid,
  p_entry_date date,
  p_reference text,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_entry uuid; v_line jsonb; v_debit numeric:=0; v_credit numeric:=0; v_code text; v_kind text; v_label text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  IF p_entry_date IS NULL OR p_reference IS NULL OR btrim(p_reference)='' THEN RAISE EXCEPTION 'Date et référence comptables obligatoires'; END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<2 THEN RAISE EXCEPTION 'Une écriture doit contenir au moins deux lignes'; END IF;
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE organization_id=p_org AND source_type=p_source_type AND source_id=p_source_id AND status='posted') THEN
    SELECT id INTO v_entry FROM public.journal_entries WHERE organization_id=p_org AND source_type=p_source_type AND source_id=p_source_id AND status='posted' ORDER BY created_at LIMIT 1;
    RETURN v_entry;
  END IF;
  INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
  VALUES(p_org,p_entry_date,btrim(p_reference),p_description,p_source_type,p_source_id,0,0,'posted') RETURNING id INTO v_entry;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_code:=NULLIF(v_line->>'pcg_code','');
    v_kind:=COALESCE(v_line->>'account_kind','pcg');
    IF v_kind='pcg' THEN
      IF v_code IS NULL OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_code) THEN RAISE EXCEPTION 'Compte PCG invalide ou absent: %',v_code; END IF;
      SELECT kind,label INTO v_kind,v_label FROM public.pcg2005_accounts WHERE code=v_code;
      v_kind:='pcg';
    ELSE
      v_label:=COALESCE(v_line->>'account_label','Trésorerie');
    END IF;
    IF COALESCE((v_line->>'debit')::numeric,0)<0 OR COALESCE((v_line->>'credit')::numeric,0)<0 THEN RAISE EXCEPTION 'Montant comptable négatif'; END IF;
    IF COALESCE((v_line->>'debit')::numeric,0)>0 AND COALESCE((v_line->>'credit')::numeric,0)>0 THEN RAISE EXCEPTION 'Une ligne ne peut pas être simultanément débit et crédit'; END IF;
    v_debit:=v_debit+COALESCE((v_line->>'debit')::numeric,0); v_credit:=v_credit+COALESCE((v_line->>'credit')::numeric,0);
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id)
    VALUES(p_org,v_entry,
      CASE WHEN v_line->>'account_kind'='treasury' THEN 'TREASURY:'||v_line->>'financial_account_id' ELSE 'PCG:'||v_code END,
      v_label,COALESCE((v_line->>'debit')::numeric,0),COALESCE((v_line->>'credit')::numeric,0),
      NULLIF(v_line->>'financial_account_id','')::uuid,NULLIF(v_line->>'customer_id','')::uuid);
  END LOOP;
  IF round(v_debit,2)<>round(v_credit,2) THEN RAISE EXCEPTION 'Écriture déséquilibrée: débit %, crédit %',v_debit,v_credit; END IF;
  UPDATE public.journal_entries SET total_debit=v_debit,total_credit=v_credit WHERE id=v_entry;
  PERFORM public.magnisa_assert_journal_balanced(v_entry);
  RETURN v_entry;
END; $$;

-- Default global rules are configuration, not application hard-coding.
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,fee_account_code,priority)
VALUES
('customer_payment','settlement','customer_receivable',NULL,'411',NULL,100),
('supplier_payment','settlement','supplier_payable','401',NULL,NULL,100),
('transaction_fee','fee','mobile_money',NULL,NULL,'627',100),
('transaction_fee','fee','bank',NULL,NULL,'627',100),
('transaction_fee','fee','cash_withdrawal',NULL,NULL,'627',100),
('internal_transfer','transfer','internal_transfer','581',NULL,NULL,100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_expense(
  p_org uuid,p_description text,p_amount numeric,p_date date,p_account uuid,p_category text,
  p_expense_nature text DEFAULT 'expense',p_supplier_id uuid DEFAULT NULL,p_document_reference text DEFAULT NULL,
  p_fee_amount numeric DEFAULT 0,p_fee_bearer text DEFAULT 'none'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%rowtype; v_id uuid; v_entry uuid; v_ref text; v_code text; v_fee_code text; v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'expenses.record');
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF p_fee_amount IS NULL OR p_fee_amount<0 THEN RAISE EXCEPTION 'Frais invalides'; END IF;
  IF p_fee_bearer NOT IN ('company','client','shared','none') THEN RAISE EXCEPTION 'Prise en charge des frais invalide'; END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  SELECT code INTO v_code FROM public.pcg2005_accounts WHERE code=trim(p_category) AND kind IN ('expense','asset','clearing','liability');
  IF v_code IS NULL THEN RAISE EXCEPTION 'Compte de destination comptable invalide ou non configuré: %',trim(p_category); END IF;
  IF p_fee_bearer<>'none' AND p_fee_amount=0 THEN RAISE EXCEPTION 'Un frais pris en charge doit avoir un montant'; END IF;
  IF p_fee_bearer='none' AND p_fee_amount<>0 THEN RAISE EXCEPTION 'Un frais sans prise en charge ne peut pas avoir de montant'; END IF;
  v_ref:=public.next_document_number(p_org,'expense');
  INSERT INTO public.expenses(organization_id,financial_account_id,description,category,expense_account_code,amount,expense_date,status,created_by,magnisa_reference,expense_nature,supplier_id,document_reference,fee_amount,fee_bearer)
  VALUES(p_org,a.id,trim(p_description),trim(p_category),v_code,p_amount,p_date,'paid',auth.uid(),v_ref,p_expense_nature,p_supplier_id,NULLIF(trim(p_document_reference),''),p_fee_amount,p_fee_bearer) RETURNING id INTO v_id;
  UPDATE public.financial_accounts SET balance=balance-p_amount-CASE WHEN p_fee_bearer='company' THEN p_fee_amount ELSE 0 END,updated_at=now() WHERE id=a.id;
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  VALUES(p_org,a.id,p_date,-p_amount,'expense','expense',v_id,v_ref,p_description);
  IF p_fee_bearer='company' AND p_fee_amount>0 THEN
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,a.id,p_date,-p_fee_amount,'expense','expense_fee',v_id,v_ref,'Frais de transaction supportés par l’entreprise');
  END IF;
  IF p_expense_nature='expense' THEN
    v_lines:=jsonb_build_array(jsonb_build_object('pcg_code',v_code,'debit',p_amount,'credit',0,'account_kind','pcg'),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_amount));
  ELSE
    v_lines:=jsonb_build_array(jsonb_build_object('pcg_code',v_code,'debit',p_amount,'credit',0,'account_kind','pcg'),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_amount));
  END IF;
  IF p_fee_bearer='company' AND p_fee_amount>0 THEN
    v_fee_code:=public.magnisa_resolve_pcg_account(p_org,'transaction_fee','fee',CASE WHEN a.type='mobile_money' THEN 'mobile_money' WHEN a.type='bank' THEN 'bank' ELSE 'cash_withdrawal' END,'fee');
    v_lines:=v_lines || jsonb_build_array(jsonb_build_object('pcg_code',v_fee_code,'debit',p_fee_amount,'credit',0,'account_kind','pcg'),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_fee_amount));
  END IF;
  v_entry:=public.magnisa_post_journal(p_org,p_date,v_ref,p_description,'expense',v_id,v_lines);
  PERFORM public.audit_event(p_org,'expense.recorded','expense',v_id,NULL,jsonb_build_object('amount',p_amount,'expense_account_code',v_code,'expense_nature',p_expense_nature,'fee_amount',p_fee_amount,'fee_bearer',p_fee_bearer));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.invoices%rowtype; a public.financial_accounts%rowtype; v_payment uuid; v_ref text; v_entry uuid; v_ar text;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'payments.record');
  IF p_amount IS NULL OR p_amount<=0 OR p_paid_at IS NULL THEN RAISE EXCEPTION 'Paiement invalide'; END IF;
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR i.status IN ('draft','cancelled') OR p_amount>i.balance_due THEN RAISE EXCEPTION 'Facture ou montant de paiement invalide'; END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  IF p_method='cheque' AND a.type<>'cheque_clearing' THEN RAISE EXCEPTION 'Un chèque reçu doit aller dans Chèques à encaisser'; END IF;
  IF p_method='cash' AND a.type<>'cash' THEN RAISE EXCEPTION 'Un paiement en espèces doit aller dans un compte Caisse'; END IF;
  v_ref:=coalesce(nullif(trim(p_reference),''),public.next_document_number(p_org,'payment'));
  INSERT INTO public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
  VALUES(p_org,i.id,i.customer_id,a.id,v_ref,p_amount,p_method,'confirmed',p_paid_at,auth.uid()) RETURNING id INTO v_payment;
  UPDATE public.financial_accounts SET balance=balance+p_amount,updated_at=now() WHERE id=a.id;
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  VALUES(p_org,a.id,p_paid_at,p_amount,'customer_payment','payment',v_payment,v_ref,'Paiement facture '||i.number);
  UPDATE public.invoices SET paid_amount=i.paid_amount+p_amount,balance_due=i.balance_due-p_amount,status=CASE WHEN i.balance_due-p_amount=0 THEN 'paid' WHEN i.due_date IS NOT NULL AND i.due_date<current_date THEN 'overdue' ELSE 'partially_paid' END,updated_at=now() WHERE id=i.id;
  v_ar:=public.magnisa_resolve_pcg_account(p_org,'customer_payment','settlement','customer_receivable','credit');
  v_entry:=public.magnisa_post_journal(p_org,p_paid_at,v_ref,'Encaissement '||i.number,'payment',v_payment,jsonb_build_array(
    jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',p_amount,'credit',0,'customer_id',i.customer_id::text),
    jsonb_build_object('pcg_code',v_ar,'debit',0,'credit',p_amount,'account_kind','pcg','customer_id',i.customer_id::text)
  ));
  PERFORM public.audit_event(p_org,'payment.recorded','payment',v_payment,NULL,jsonb_build_object('invoice_id',i.id,'amount',p_amount,'account_id',a.id,'reference',v_ref,'journal_entry_id',v_entry));
  RETURN v_payment;
END; $$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text DEFAULT NULL,
  p_fee_amount numeric DEFAULT 0,p_fee_bearer text DEFAULT 'none'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE si public.supplier_invoices%rowtype; a public.financial_accounts%rowtype; v_id uuid; v_ref text; v_entry uuid; v_ap text; v_fee text; v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_amount IS NULL OR p_amount<=0 OR p_fee_amount<0 THEN RAISE EXCEPTION 'Montants invalides'; END IF;
  IF p_fee_bearer NOT IN ('company','client','shared','none') THEN RAISE EXCEPTION 'Prise en charge des frais invalide'; END IF;
  IF p_fee_bearer='company' AND p_fee_amount=0 THEN RAISE EXCEPTION 'Montant de frais entreprise obligatoire'; END IF;
  SELECT * INTO si FROM public.supplier_invoices WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR si.status='cancelled' OR p_amount>si.balance_due THEN RAISE EXCEPTION 'Facture fournisseur ou montant invalide'; END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  v_ref:=coalesce(nullif(trim(p_reference),''),public.next_document_number(p_org,'payment'));
  INSERT INTO public.supplier_payments(organization_id,supplier_invoice_id,supplier_id,financial_account_id,amount,payment_date,reference,method,created_by,fee_amount,fee_bearer)
  VALUES(p_org,si.id,si.supplier_id,a.id,p_amount,p_date,v_ref,p_method,auth.uid(),p_fee_amount,p_fee_bearer) RETURNING id INTO v_id;
  UPDATE public.supplier_invoices SET paid_amount=si.paid_amount+p_amount,balance_due=greatest(si.total-(si.paid_amount+p_amount),0),status=CASE WHEN greatest(si.total-(si.paid_amount+p_amount),0)=0 THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=si.id;
  UPDATE public.financial_accounts SET balance=balance-p_amount-CASE WHEN p_fee_bearer='company' THEN p_fee_amount ELSE 0 END,updated_at=now() WHERE id=a.id;
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  VALUES(p_org,a.id,p_date,-p_amount,'expense','supplier_payment',v_id,v_ref,'Règlement fournisseur');
  IF p_fee_bearer='company' AND p_fee_amount>0 THEN
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,a.id,p_date,-p_fee_amount,'expense','supplier_payment_fee',v_id,v_ref,'Frais de transaction supportés par l’entreprise');
  END IF;
  v_ap:=public.magnisa_resolve_pcg_account(p_org,'supplier_payment','settlement','supplier_payable','debit');
  v_lines:=jsonb_build_array(jsonb_build_object('pcg_code',v_ap,'debit',p_amount,'credit',0,'account_kind','pcg'),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_amount));
  IF p_fee_bearer='company' AND p_fee_amount>0 THEN
    v_fee:=public.magnisa_resolve_pcg_account(p_org,'transaction_fee','fee',CASE WHEN a.type='mobile_money' THEN 'mobile_money' WHEN a.type='bank' THEN 'bank' ELSE 'cash_withdrawal' END,'fee');
    v_lines:=v_lines || jsonb_build_array(jsonb_build_object('pcg_code',v_fee,'debit',p_fee_amount,'credit',0,'account_kind','pcg'),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_fee_amount));
  END IF;
  v_entry:=public.magnisa_post_journal(p_org,p_date,v_ref,'Règlement fournisseur','supplier_payment',v_id,v_lines);
  PERFORM public.audit_event(p_org,'supplier_payment.recorded','supplier_payment',v_id,NULL,jsonb_build_object('supplier_invoice_id',si.id,'amount',p_amount,'fee_amount',p_fee_amount,'fee_bearer',p_fee_bearer,'journal_entry_id',v_entry));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.lot2_record_supplier_payment_idempotent(
 p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text,p_request_key uuid,
 p_fee_amount numeric DEFAULT 0,p_fee_bearer text DEFAULT 'none'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'suppliers.manage');
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'Cle de requete obligatoire'; END IF;
 v_digest:=md5(jsonb_build_array(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference,p_fee_amount,p_fee_bearer)::text);
 INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) VALUES(p_org,p_request_key,'supplier_payment',v_digest) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
 IF v_old.operation_type<>'supplier_payment' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Cle de repetition deja utilisee pour une autre operation'; END IF;
 IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
 v_id:=public.record_supplier_payment(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference,p_fee_amount,p_fee_bearer);
 UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
 RETURN v_id;
END; $$;

-- Keep old signatures callable by existing clients while routing through the new engine.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(uuid,uuid,uuid,numeric,text,date,text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.record_supplier_payment($1,$2,$3,$4,$5,$6,$7,0,'none')
$$;

REVOKE ALL ON FUNCTION public.magnisa_resolve_pcg_account(uuid,text,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_post_journal(uuid,date,text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_resolve_pcg_account(uuid,text,text,text,text) TO authenticated;

COMMENT ON TABLE public.accounting_posting_rules IS 'Versioned central accounting rules used by operational posting RPCs. Organization-specific rules override global defaults.';
