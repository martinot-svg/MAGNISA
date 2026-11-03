DO $migration$
DECLARE v_definition text; v_old text; v_new text;
BEGIN
  v_definition := pg_get_functiondef('public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb)'::regprocedure);
  v_old := 'IF NOT FOUND THEN
    RAISE EXCEPTION ''Version active introuvable'';
  END IF;';
  v_new := v_old || '

  IF p_effective_from < v_current.effective_from THEN
    RAISE EXCEPTION ''Date antérieure au début de la version active'';
  END IF;';
  IF position(v_old in v_definition) = 0 THEN RAISE EXCEPTION 'Active version validation block not found'; END IF;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'IF EXISTS (
    SELECT 1
    FROM public.loan_repayments r
    JOIN public.loan_installments i
      ON i.id = r.installment_id
     AND i.organization_id = r.organization_id
    WHERE r.loan_id = p_loan_id
      AND r.organization_id = p_organization_id
      AND r.status = ''posted''
      AND r.payment_date >= p_effective_from
      AND i.schedule_version_id = v_current.id
  ) THEN
    RAISE EXCEPTION ''Des remboursements existent déjà à partir de la date d''''effet'';
  END IF;';
  v_new := 'IF EXISTS (
    SELECT 1
    FROM public.loan_repayments r
    WHERE r.loan_id = p_loan_id
      AND r.organization_id = p_organization_id
      AND r.status = ''posted''
      AND r.payment_date >= p_effective_from
  ) THEN
    RAISE EXCEPTION ''Des remboursements existent déjà à partir de la date d''''effet'';
  END IF;';
  IF position(v_old in v_definition) = 0 THEN RAISE EXCEPTION 'Posted repayment check block not found'; END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END
$migration$;
