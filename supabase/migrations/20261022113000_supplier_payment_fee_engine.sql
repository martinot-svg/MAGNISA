CREATE OR REPLACE FUNCTION public.record_supplier_payment_v2(
  p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text,
  p_fee_amount numeric,p_fee_company_amount numeric,p_fee_client_amount numeric,p_fee_bearer text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE si public.supplier_invoices%rowtype; a public.financial_accounts%rowtype; v_id uuid; v_ref text; v_entry uuid; v_ap text; v_fee text; v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'suppliers.manage');
  IF p_amount<=0 OR p_fee_amount<0 OR p_fee_company_amount<0 OR p_fee_client_amount<0 OR round(p_fee_company_amount+p_fee_client_amount,2)<>round(p_fee_amount,2) THEN RAISE EXCEPTION 'Montants de règlement ou frais incohérents'; END IF;
  IF p_fee_bearer NOT IN ('company','client','shared','none') THEN RAISE EXCEPTION 'Prise en charge des frais invalide'; END IF;
  IF p_fee_bearer='none' AND p_fee_amount<>0 THEN RAISE EXCEPTION 'Un frais déclaré inexistant doit être nul'; END IF;
  IF p_fee_bearer='company' AND p_fee_client_amount<>0 THEN RAISE EXCEPTION 'Part client interdite'; END IF;
  IF p_fee_bearer='client' AND p_fee_company_amount<>0 THEN RAISE EXCEPTION 'Part entreprise interdite'; END IF;
  IF p_fee_bearer='shared' AND (p_fee_company_amount=0 OR p_fee_client_amount=0) THEN RAISE EXCEPTION 'Un frais partagé doit préciser les deux parts'; END IF;
  SELECT * INTO si FROM public.supplier_invoices WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR si.status='cancelled' OR p_amount>si.balance_due THEN RAISE EXCEPTION 'Facture fournisseur ou montant invalide'; END IF;
  SELECT * INTO a FROM public.financial_accounts WHERE id=p_account AND organization_id=p_org AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;
  v_ref:=coalesce(nullif(trim(p_reference),''),public.next_document_number(p_org,'payment'));
  INSERT INTO public.supplier_payments(organization_id,supplier_invoice_id,supplier_id,financial_account_id,amount,payment_date,reference,method,created_by,fee_amount,fee_company_amount,fee_client_amount,fee_bearer)
  VALUES(p_org,si.id,si.supplier_id,a.id,p_amount,p_date,v_ref,p_method,auth.uid(),p_fee_amount,p_fee_company_amount,p_fee_client_amount,p_fee_bearer) RETURNING id INTO v_id;
  UPDATE public.supplier_invoices SET paid_amount=si.paid_amount+p_amount,balance_due=greatest(si.total-si.paid_amount-p_amount,0),status=CASE WHEN greatest(si.total-si.paid_amount-p_amount,0)=0 THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=si.id;
  UPDATE public.financial_accounts SET balance=balance-p_amount-p_fee_company_amount,updated_at=now() WHERE id=a.id;
  INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) VALUES(p_org,a.id,p_date,-p_amount,'expense','supplier_payment',v_id,v_ref,'Règlement fournisseur');
  IF p_fee_company_amount>0 THEN INSERT INTO public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) VALUES(p_org,a.id,p_date,-p_fee_company_amount,'expense','supplier_payment_fee',v_id,v_ref,'Frais supportés par l’entreprise'); END IF;
  v_ap:=public.magnisa_resolve_pcg_account(p_org,'supplier_payment','settlement','supplier_payable','debit');
  v_lines:=jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_ap,'debit',p_amount,'credit',0),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_amount));
  IF p_fee_company_amount>0 THEN
    v_fee:=public.magnisa_resolve_pcg_account(p_org,'transaction_fee','fee',CASE WHEN a.type='mobile_money' THEN 'mobile_money' WHEN a.type='bank' THEN 'bank' ELSE 'cash_withdrawal' END,'fee');
    v_lines:=v_lines || jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',v_fee,'debit',p_fee_company_amount,'credit',0),jsonb_build_object('account_kind','treasury','financial_account_id',a.id::text,'account_label',a.name,'debit',0,'credit',p_fee_company_amount));
  END IF;
  v_entry:=public.magnisa_post_journal(p_org,p_date,v_ref,'Règlement fournisseur','supplier_payment',v_id,v_lines);
  PERFORM public.audit_event(p_org,'supplier_payment.recorded','supplier_payment',v_id,NULL,jsonb_build_object('supplier_invoice_id',si.id,'amount',p_amount,'fee_amount',p_fee_amount,'fee_bearer',p_fee_bearer,'journal_entry_id',v_entry));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.lot2_record_supplier_payment_v2_idempotent(
 p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text,p_request_key uuid,
 p_fee_amount numeric,p_fee_company_amount numeric,p_fee_client_amount numeric,p_fee_bearer text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_digest text; v_old public.lot1_financial_idempotency%rowtype; v_id uuid;
BEGIN
 PERFORM public.assert_org_access(p_org); PERFORM public.assert_org_permission(p_org,'suppliers.manage');
 IF p_request_key IS NULL THEN RAISE EXCEPTION 'Clé de requête obligatoire'; END IF;
 v_digest:=md5(jsonb_build_array(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference,p_fee_amount,p_fee_company_amount,p_fee_client_amount,p_fee_bearer)::text);
 INSERT INTO public.lot1_financial_idempotency(organization_id,request_key,operation_type,request_digest) VALUES(p_org,p_request_key,'supplier_payment_v2',v_digest) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT v_old FROM public.lot1_financial_idempotency WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
 IF v_old.operation_type<>'supplier_payment_v2' OR v_old.request_digest<>v_digest THEN RAISE EXCEPTION 'Clé de requête déjà utilisée pour une autre opération'; END IF;
 IF v_old.result_id IS NOT NULL THEN RETURN v_old.result_id; END IF;
 v_id:=public.record_supplier_payment_v2(p_org,p_supplier_invoice,p_account,p_amount,p_method,p_date,p_reference,p_fee_amount,p_fee_company_amount,p_fee_client_amount,p_fee_bearer);
 UPDATE public.lot1_financial_idempotency SET result_id=v_id WHERE organization_id=p_org AND request_key=p_request_key;
 RETURN v_id;
END; $$;
