-- Centralize customer payment and Mobile Money fee accounting.
INSERT INTO public.pcg2005_accounts(code,label,kind)
SELECT '758','Autres produits divers de gestion courante','income'
WHERE NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='758');
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,fee_account_code,priority)
VALUES ('transaction_fee','fee','client_recharged',NULL,'758',NULL,100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.record_customer_payment_with_fee_v2(
  p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text,p_request_key uuid,p_fee_amount numeric DEFAULT 0,p_fee_bearer text DEFAULT 'none'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_payment public.payments%rowtype; v_account public.financial_accounts%rowtype; v_ref text; v_fee_code text; v_lines jsonb; v_entry uuid;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'payments.record');
  IF p_fee_amount IS NULL OR p_fee_amount<0 THEN RAISE EXCEPTION 'Montant de frais invalide'; END IF;
  IF p_fee_bearer NOT IN ('company','client_direct','client_reimbursed','none') THEN RAISE EXCEPTION 'Prise en charge des frais invalide'; END IF;
  IF p_fee_bearer='none' AND p_fee_amount<>0 THEN RAISE EXCEPTION 'Aucun frais ne peut avoir un montant non nul'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_paid_at);
  SELECT * INTO v_account FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  v_id:=public.lot1_record_invoice_payment_idempotent(p_org,p_invoice,p_account,p_amount,p_paid_at,p_method,p_reference,p_request_key);
  SELECT * INTO v_payment FROM public.payments WHERE id=v_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paiement introuvable'; END IF;
  UPDATE public.payments SET mvola_fee_amount=p_fee_amount,mvola_fee_reimbursement=CASE WHEN p_fee_bearer='client_reimbursed' THEN p_fee_amount ELSE 0 END,mvola_fee_bearer=p_fee_bearer WHERE id=v_id AND organization_id=p_org;
  IF p_fee_amount=0 OR p_fee_bearer IN ('none','client_direct') THEN RETURN v_id; END IF;
  v_ref:=coalesce(v_payment.reference,public.next_document_number(p_org,'payment'));
  IF p_fee_bearer='company' THEN
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,p_account,p_paid_at,-p_fee_amount,'fee','mvola_fee_company',v_id,v_ref,'Frais Mobile Money supportés par l’entreprise');
    UPDATE public.financial_accounts SET balance=balance-p_fee_amount,updated_at=now() WHERE id=p_account;
    v_fee_code:=public.magnisa_resolve_pcg_account(p_org,'transaction_fee','fee',CASE WHEN v_account.type='mobile_money' THEN 'mobile_money' WHEN v_account.type='bank' THEN 'bank' ELSE 'cash_withdrawal' END,'fee');
    v_lines:=jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_fee_code,'debit',p_fee_amount,'credit',0),jsonb_build_object('account_kind','treasury','financial_account_id',p_account::text,'account_label',v_account.name,'debit',0,'credit',p_fee_amount));
  ELSE
    INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
    VALUES(p_org,p_account,p_paid_at,p_fee_amount,'customer_fee_recharge','mvola_fee_recharged',v_id,v_ref,'Frais Mobile Money refacturés au client');
    UPDATE public.financial_accounts SET balance=balance+p_fee_amount,updated_at=now() WHERE id=p_account;
    v_fee_code:=public.magnisa_resolve_pcg_account(p_org,'transaction_fee','fee','client_recharged','credit');
    v_lines:=jsonb_build_array(jsonb_build_object('account_kind','treasury','financial_account_id',p_account::text,'account_label',v_account.name,'debit',p_fee_amount,'credit',0,'customer_id',v_payment.customer_id),jsonb_build_object('account_kind','pcg','pcg_code',v_fee_code,'debit',0,'credit',p_fee_amount,'customer_id',v_payment.customer_id));
  END IF;
  v_entry:=public.magnisa_post_journal(p_org,p_paid_at,v_ref,'Frais Mobile Money','customer_payment_fee',v_id,v_lines);
  PERFORM public.audit_event(p_org,'customer_payment.fee_recorded','payment',v_id,NULL,jsonb_build_object('fee_amount',p_fee_amount,'fee_bearer',p_fee_bearer,'journal_entry_id',v_entry));
  RETURN v_id;
END; $$;
