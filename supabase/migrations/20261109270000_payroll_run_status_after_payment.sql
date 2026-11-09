-- Keep the payroll run lifecycle synchronized with partial and full payslip payments.
-- Existing payment, cash and journal operations remain in the same transaction.
CREATE OR REPLACE FUNCTION public.record_payroll_payment(
  p_org uuid,
  p_payslip uuid,
  p_account uuid,
  p_amount numeric,
  p_method text,
  p_date date,
  p_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ps public.payslips%ROWTYPE;
  a public.financial_accounts%ROWTYPE;
  v_id uuid;
  v_entry uuid;
  v_new_paid numeric;
  v_ref text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'payroll.pay');

  IF p_amount IS NULL OR p_amount<=0 THEN
    RAISE EXCEPTION 'Montant invalide';
  END IF;

  SELECT * INTO ps
  FROM public.payslips
  WHERE id=p_payslip AND organization_id=p_org
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Bulletin introuvable'; END IF;
  IF ps.status NOT IN ('validated','partially_paid') THEN
    RAISE EXCEPTION 'Le bulletin doit être validé avant paiement';
  END IF;
  IF ps.paid_amount+p_amount>ps.net_pay THEN
    RAISE EXCEPTION 'Le paiement dépasse le net à payer';
  END IF;

  SELECT * INTO a
  FROM public.financial_accounts
  WHERE id=p_account AND organization_id=p_org AND is_active
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Compte financier invalide'; END IF;

  v_ref := coalesce(nullif(trim(coalesce(p_reference,'')),''),'SAL-'||left(ps.id::text,8));

  INSERT INTO public.payroll_payments(
    organization_id,payslip_id,employee_id,financial_account_id,amount,payment_date,method,reference,created_by
  )
  VALUES(p_org,ps.id,ps.employee_id,a.id,p_amount,p_date,p_method,v_ref,auth.uid())
  RETURNING id INTO v_id;

  v_new_paid:=ps.paid_amount+p_amount;
  UPDATE public.payslips
  SET paid_amount=v_new_paid,
      status=CASE WHEN v_new_paid=net_pay THEN 'paid' ELSE 'partially_paid' END,
      updated_at=now()
  WHERE id=ps.id;

  UPDATE public.financial_accounts
  SET balance=balance-p_amount,updated_at=now()
  WHERE id=a.id;

  INSERT INTO public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  )
  VALUES(p_org,a.id,p_date,-p_amount,'expense','payroll_payment',v_id,v_ref,'Paiement salaire');

  INSERT INTO public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  VALUES(p_org,p_date,v_ref,'Paiement salaire','payroll_payment',v_id,p_amount,p_amount)
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_entry_lines(
    organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id
  )
  VALUES
    (p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',p_amount,0,NULL),
    (p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);

  -- A run is partially paid while at least one non-cancelled payslip has
  -- received a payment; it is paid only when every non-cancelled payslip is paid.
  UPDATE public.payroll_runs r
  SET status = CASE
    WHEN EXISTS (
      SELECT 1 FROM public.payslips s
      WHERE s.organization_id=p_org AND s.payroll_run_id=ps.payroll_run_id
        AND s.status<>'cancelled'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payslips s
      WHERE s.organization_id=p_org AND s.payroll_run_id=ps.payroll_run_id
        AND s.status NOT IN ('paid','cancelled')
    ) THEN 'paid'
    WHEN EXISTS (
      SELECT 1 FROM public.payslips s
      WHERE s.organization_id=p_org AND s.payroll_run_id=ps.payroll_run_id
        AND s.status IN ('partially_paid','paid')
    ) THEN 'partially_paid'
    ELSE r.status
  END,
  updated_at=now()
  WHERE r.id=ps.payroll_run_id
    AND r.organization_id=p_org
    AND r.status<>'cancelled';

  PERFORM public.audit_event(
    p_org,'payroll_payment.recorded','payroll_payment',v_id,NULL,
    jsonb_build_object('payslip_id',ps.id,'amount',p_amount,'account_id',a.id)
  );

  RETURN v_id;
END;
$$;
