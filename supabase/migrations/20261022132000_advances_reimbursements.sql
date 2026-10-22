-- MAGNISA advances and reimbursements
-- Uses PCG 2005 third-party accounts from the active chart. 409 is the standard supplier-debtor advance account; 419 is the customer-creditor advance account.

INSERT INTO public.pcg2005_accounts(code,label,kind)
SELECT '409','Fournisseurs débiteurs : avances et acomptes, RRR à obtenir, autres créances','asset'
WHERE NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='409');
INSERT INTO public.pcg2005_accounts(code,label,kind)
SELECT '467','Autres comptes débiteurs ou créditeurs','asset'
WHERE NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='467');

INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority)
VALUES ('advance','recognition','supplier_advance','409',NULL,100),
       ('advance','recognition','customer_advance',NULL,'419',100),
       ('advance','settlement','supplier_advance','401',NULL,100),
       ('advance','settlement','customer_advance',NULL,'411',100),
       ('expense','settlement','reimbursement','467',NULL,100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.magnisa_record_advance_idempotent(
  p_org uuid,p_direction text,p_third_party_id uuid,p_account uuid,p_amount numeric,p_date date,p_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_id uuid; v_a public.financial_accounts%rowtype; v_debit text; v_credit text; v_lines jsonb; v_ref text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,CASE WHEN p_direction='supplier' THEN 'suppliers.manage' ELSE 'payments.record' END);
  IF p_direction NOT IN ('supplier','customer') OR p_amount<=0 OR p_request_key IS NULL THEN RAISE EXCEPTION 'Avance invalide'; END IF;
  IF p_third_party_id IS NULL OR p_account IS NULL OR nullif(btrim(p_reference),'') IS NULL THEN RAISE EXCEPTION 'Tiers, compte de trésorerie et référence obligatoires'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  v_digest:=md5(jsonb_build_array(p_org,p_direction,p_third_party_id,p_account,p_amount,p_date,p_reference)::text);
  INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) VALUES(p_org,p_request_key,'advance',v_digest) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF v_old.operation_type<>'advance' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
  IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
  SELECT * INTO v_a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  IF p_direction='supplier' THEN
    v_debit:=public.magnisa_resolve_pcg_account(p_org,'advance','recognition','supplier_advance','debit');
    IF v_a.balance<p_amount THEN RAISE EXCEPTION 'Solde insuffisant'; END IF;
    UPDATE public.financial_accounts SET balance=balance-p_amount,updated_at=now() WHERE id=v_a.id;
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) VALUES(p_org,v_a.id,p_date,-p_amount,'advance','supplier_advance',p_third_party_id,btrim(p_reference),'Avance fournisseur');
    v_lines:=jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_debit,'debit',p_amount,'credit',0,'supplier_id',p_third_party_id),jsonb_build_object('account_kind','treasury','financial_account_id',v_a.id::text,'account_label',v_a.name,'debit',0,'credit',p_amount));
  ELSE
    v_credit:=public.magnisa_resolve_pcg_account(p_org,'advance','recognition','customer_advance','credit');
    UPDATE public.financial_accounts SET balance=balance+p_amount,updated_at=now() WHERE id=v_a.id;
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) VALUES(p_org,v_a.id,p_date,p_amount,'advance','customer_advance',p_third_party_id,btrim(p_reference),'Avance client');
    v_lines:=jsonb_build_array(jsonb_build_object('account_kind','treasury','financial_account_id',v_a.id::text,'account_label',v_a.name,'debit',p_amount,'credit',0,'customer_id',p_third_party_id),jsonb_build_object('account_kind','pcg','pcg_code',v_credit,'debit',0,'credit',p_amount,'customer_id',p_third_party_id));
  END IF;
  v_ref:=btrim(p_reference);
  v_id:=public.magnisa_post_journal(p_org,p_date,v_ref,CASE WHEN p_direction='supplier' THEN 'Avance fournisseur' ELSE 'Avance client' END,'advance',p_third_party_id,v_lines);
  UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.magnisa_reimburse_recorded_expense(
  p_org uuid,p_expense uuid,p_account uuid,p_amount numeric,p_date date,p_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_a public.financial_accounts%rowtype; v_exp public.expenses%rowtype; v_id uuid; v_ref text; v_debit text; v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'expenses.record');
  IF p_amount<=0 OR p_request_key IS NULL OR nullif(btrim(p_reference),'') IS NULL THEN RAISE EXCEPTION 'Remboursement invalide'; END IF;
  SELECT * INTO v_exp FROM public.expenses WHERE id=p_expense AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépense introuvable'; END IF;
  IF p_amount>v_exp.amount THEN RAISE EXCEPTION 'Le remboursement dépasse la dépense enregistrée'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  v_digest:=md5(jsonb_build_array(p_org,p_expense,p_account,p_amount,p_date,p_reference)::text);
  INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) VALUES(p_org,p_request_key,'expense_reimbursement',v_digest) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF v_old.operation_type<>'expense_reimbursement' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
  IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
  SELECT * INTO v_a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND OR v_a.balance<p_amount THEN RAISE EXCEPTION 'Compte financier invalide ou solde insuffisant'; END IF;
  v_debit:=public.magnisa_resolve_pcg_account(p_org,'expense','settlement','reimbursement','debit');
  UPDATE public.financial_accounts SET balance=balance-p_amount,updated_at=now() WHERE id=v_a.id;
  v_ref:=btrim(p_reference);
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) VALUES(p_org,v_a.id,p_date,-p_amount,'reimbursement','expense_reimbursement',p_expense,v_ref,'Remboursement d''une dépense enregistrée');
  v_lines:=jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_debit,'debit',p_amount,'credit',0),jsonb_build_object('account_kind','treasury','financial_account_id',v_a.id::text,'account_label',v_a.name,'debit',0,'credit',p_amount));
  v_id:=public.magnisa_post_journal(p_org,p_date,v_ref,'Remboursement de dépense','expense_reimbursement',p_expense,v_lines);
  UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
  RETURN v_id;
END; $$;
