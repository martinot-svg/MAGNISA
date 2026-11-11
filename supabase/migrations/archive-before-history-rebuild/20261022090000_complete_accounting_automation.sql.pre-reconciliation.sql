-- MAGNISA complete accounting automation
-- New expense postings use configured PCG accounts and payment fees are explicitly classified.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS expense_account_code text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS mvola_fee_amount numeric, ADD COLUMN IF NOT EXISTS mvola_fee_bearer text;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_expense_account_code_fk FOREIGN KEY (expense_account_code) REFERENCES public.pcg2005_accounts(code) NOT VALID;
ALTER TABLE public.payments ADD CONSTRAINT payments_mvola_fee_bearer_chk CHECK (mvola_fee_bearer IS NULL OR mvola_fee_bearer IN ('company','client_direct','client_reimbursed','none'));

CREATE OR REPLACE FUNCTION public.magnisa_assert_journal_balanced(p_entry uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE h public.journal_entries%rowtype; d numeric; c numeric;
BEGIN
  SELECT * INTO h FROM public.journal_entries WHERE id=p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable'; END IF;
  SELECT COALESCE(sum(debit),0),COALESCE(sum(credit),0) INTO d,c FROM public.journal_entry_lines WHERE journal_entry_id=p_entry;
  IF round(d,2)<>round(c,2) OR round(d,2)<>round(h.total_debit,2) OR round(c,2)<>round(h.total_credit,2) THEN
    RAISE EXCEPTION 'Écriture déséquilibrée: débit %, crédit %',d,c;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.magnisa_journal_balance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.magnisa_assert_journal_balanced(COALESCE(NEW.journal_entry_id,OLD.journal_entry_id));
  RETURN COALESCE(NEW,OLD);
END; $$;
DROP TRIGGER IF EXISTS magnisa_journal_balance_guard ON public.journal_entry_lines;
CREATE CONSTRAINT TRIGGER magnisa_journal_balance_guard AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.magnisa_journal_balance_guard();

CREATE OR REPLACE FUNCTION public.record_expense(p_org uuid,p_description text,p_amount numeric,p_date date,p_account uuid,p_category text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.financial_accounts%rowtype; v_expense uuid; v_entry uuid; v_number text; v_code text; v_label text;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'expenses.record');
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF length(trim(coalesce(p_description,'')))<2 THEN RAISE EXCEPTION 'Description requise'; END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  SELECT code,label INTO v_code,v_label FROM public.pcg2005_accounts WHERE code=trim(p_category) AND kind='expense';
  IF v_code IS NULL THEN
    SELECT m.pcg_code,a2.label INTO v_code,v_label FROM public.pcg2005_account_mappings m
    JOIN public.pcg2005_accounts a2 ON a2.code=m.pcg_code
    WHERE m.organization_id=p_org AND m.legacy_account_key=trim(p_category) AND a2.kind='expense' LIMIT 1;
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Compte de charge PCG invalide ou non configuré: %',trim(p_category); END IF;
  v_number:=public.next_document_number(p_org,'expense');
  INSERT INTO public.expenses(organization_id,financial_account_id,description,category,expense_account_code,amount,expense_date,status,created_by,magnisa_reference)
  VALUES(p_org,a.id,trim(p_description),v_label,v_code,p_amount,p_date,'paid',auth.uid(),v_number) RETURNING id INTO v_expense;
  UPDATE public.financial_accounts SET balance=balance-p_amount,updated_at=now() WHERE id=a.id;
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  VALUES(p_org,a.id,p_date,-p_amount,'expense','expense',v_expense,v_number,p_description);
  INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status,magnisa_reference)
  VALUES(p_org,p_date,v_number,p_description,'expense',v_expense,p_amount,p_amount,'posted',v_number) RETURNING id INTO v_entry;
  INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) VALUES
    (p_org,v_entry,'PCG:'||v_code,v_label,p_amount,0,null),(p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);
  PERFORM public.magnisa_assert_journal_balanced(v_entry);
  PERFORM public.audit_event(p_org,'expense.recorded','expense',v_expense,null,jsonb_build_object('amount',p_amount,'expense_account_code',v_code,'financial_account_id',a.id));
  RETURN v_expense;
END; $$;

CREATE OR REPLACE FUNCTION public.record_customer_payment_with_fee(
  p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text,
  p_request_key uuid,p_fee_amount numeric DEFAULT 0,p_fee_bearer text DEFAULT 'none')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_payment public.payments%rowtype; v_account public.financial_accounts%rowtype; v_fee_entry uuid; v_existing numeric;
BEGIN
  IF p_fee_amount IS NULL OR p_fee_amount<0 THEN RAISE EXCEPTION 'Montant de frais invalide'; END IF;
  IF p_fee_bearer NOT IN ('company','client_direct','client_reimbursed','none') THEN RAISE EXCEPTION 'Prise en charge des frais invalide'; END IF;
  IF p_fee_bearer='none' AND p_fee_amount<>0 THEN RAISE EXCEPTION 'Aucun frais ne peut avoir un montant non nul'; END IF;
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'payments.record');
  SELECT * INTO v_account FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  v_id:=public.lot1_record_invoice_payment_idempotent(p_org,p_invoice,p_account,p_amount,p_paid_at,p_method,p_reference,p_request_key);
  SELECT * INTO v_payment FROM public.payments WHERE id=v_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable'; END IF;
  SELECT amount INTO v_existing FROM public.financial_transactions WHERE organization_id=p_org AND source_type='mvola_fee_company' AND source_id=v_id AND financial_account_id=p_account FOR UPDATE;
  IF FOUND THEN IF v_existing<>p_fee_amount THEN RAISE EXCEPTION 'Frais déjà comptabilisés avec un montant différent'; END IF; RETURN v_id; END IF;
  UPDATE public.payments SET mvola_fee_amount=p_fee_amount,mvola_fee_bearer=p_fee_bearer WHERE id=v_id AND organization_id=p_org;
  IF p_fee_amount=0 OR p_fee_bearer='none' OR p_fee_bearer='client_direct' THEN RETURN v_id; END IF;
  IF p_fee_bearer='company' THEN
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,p_account,p_paid_at,-p_fee_amount,'fee','mvola_fee_company',v_id,v_payment.reference,'Frais Mobile Money supportés par l''entreprise');
    UPDATE public.financial_accounts SET balance=balance-p_fee_amount,updated_at=now() WHERE id=p_account;
    INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
    VALUES(p_org,p_paid_at,v_payment.reference,'Frais Mobile Money supportés par l''entreprise','mvola_fee_company',v_id,p_fee_amount,p_fee_amount,'posted') RETURNING id INTO v_fee_entry;
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) VALUES
      (p_org,v_fee_entry,'PCG:627','Services bancaires et assimilés',p_fee_amount,0,null),(p_org,v_fee_entry,'TREASURY:'||p_account::text,v_account.name,0,p_fee_amount,p_account);
    PERFORM public.magnisa_assert_journal_balanced(v_fee_entry);
  ELSIF p_fee_bearer='client_reimbursed' THEN
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,p_account,p_paid_at,p_fee_amount,'adjustment','mvola_fee_reimbursement',v_id,v_payment.reference,'Remboursement client de frais Mobile Money');
    UPDATE public.financial_accounts SET balance=balance+p_fee_amount,updated_at=now() WHERE id=p_account;
    INSERT INTO public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status)
    VALUES(p_org,p_paid_at,v_payment.reference,'Remboursement client de frais Mobile Money','mvola_fee_reimbursement',v_id,p_fee_amount,p_fee_amount,'posted') RETURNING id INTO v_fee_entry;
    INSERT INTO public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) VALUES
      (p_org,v_fee_entry,'TREASURY:'||p_account::text,v_account.name,p_fee_amount,0,p_account),(p_org,v_fee_entry,'471','Compte d''attente - frais Mobile Money à qualifier',0,p_fee_amount,null);
    PERFORM public.magnisa_assert_journal_balanced(v_fee_entry);
  END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.record_customer_payment_with_fee(uuid,uuid,uuid,numeric,date,text,text,uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_with_fee(uuid,uuid,uuid,numeric,date,text,text,uuid,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.magnisa_assert_journal_balanced(uuid) FROM PUBLIC,anon,authenticated;
