
CREATE OR REPLACE FUNCTION public.create_loan_schedule_amendment(
  p_organization_id uuid, p_loan_id uuid, p_effective_from date,
  p_amendment_reference text, p_amendment_reason text, p_installments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_loan public.loans%rowtype;
  v_current public.loan_schedule_versions%rowtype;
  v_version integer;
  v_id uuid;
  v jsonb;
  v_open numeric;
  v_principal numeric;
  v_interest numeric;
  v_fees numeric;
  v_penalty numeric;
  v_close numeric;
  v_expected_open numeric;
  v_previous_due date;
  v_number integer := 0;
BEGIN
  PERFORM public.assert_org_access(p_organization_id);
  PERFORM public.assert_org_permission(p_organization_id, 'accounting.manage');

  SELECT * INTO v_loan FROM public.loans
  WHERE id = p_loan_id AND organization_id = p_organization_id FOR UPDATE;

  IF NOT FOUND OR v_loan.status <> 'active' THEN RAISE EXCEPTION 'Emprunt introuvable ou non actif'; END IF;
  IF p_effective_from IS NULL OR p_effective_from <= v_loan.start_date THEN RAISE EXCEPTION 'Date d''effet invalide'; END IF;
  IF nullif(btrim(p_amendment_reference), '') IS NULL OR nullif(btrim(p_amendment_reason), '') IS NULL THEN RAISE EXCEPTION 'Référence et motif de l''avenant obligatoires'; END IF;
  IF jsonb_typeof(p_installments) <> 'array' OR jsonb_array_length(p_installments) < 1 THEN RAISE EXCEPTION 'Nouvel échéancier invalide'; END IF;
  IF v_loan.outstanding_principal IS NULL OR v_loan.outstanding_principal <= 0 THEN RAISE EXCEPTION 'Le capital restant dû doit être positif pour créer un avenant'; END IF;

  SELECT * INTO v_current FROM public.loan_schedule_versions
  WHERE id = v_loan.active_schedule_version_id AND loan_id = p_loan_id
    AND organization_id = p_organization_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version active introuvable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_repayments r
    JOIN public.loan_installments i ON i.id = r.installment_id AND i.organization_id = r.organization_id
    WHERE r.loan_id = p_loan_id AND r.organization_id = p_organization_id
      AND r.status = 'posted' AND r.payment_date >= p_effective_from
      AND i.schedule_version_id = v_current.id
  ) THEN RAISE EXCEPTION 'Des remboursements existent déjà à partir de la date d''effet'; END IF;

  SELECT coalesce(max(version_number), 0) + 1 INTO v_version
  FROM public.loan_schedule_versions WHERE loan_id = p_loan_id AND organization_id = p_organization_id;

  -- Validate the complete schedule before changing the active version.
  v_expected_open := round(v_loan.outstanding_principal, 2);
  v_previous_due := NULL;
  FOR v IN SELECT value FROM jsonb_array_elements(p_installments) ORDER BY (value->>'installment_number')::integer LOOP
    v_number := v_number + 1;
    IF (v->>'installment_number')::integer <> v_number THEN RAISE EXCEPTION 'Les numéros des nouvelles échéances doivent être continus et commencer à 1'; END IF;
    v_open := round((v->>'opening_principal')::numeric, 2);
    v_principal := round((v->>'principal_due')::numeric, 2);
    v_interest := round((v->>'interest_due')::numeric, 2);
    v_fees := round(coalesce((v->>'fees_due')::numeric, 0), 2);
    v_penalty := round(coalesce((v->>'penalty_due')::numeric, 0), 2);
    v_close := round(v_open - v_principal, 2);
    IF v->>'due_date' IS NULL OR (v->>'due_date')::date < p_effective_from
      OR (v_previous_due IS NOT NULL AND (v->>'due_date')::date <= v_previous_due)
      OR v_open IS NULL OR v_principal IS NULL OR v_interest IS NULL
      OR v_open < 0 OR v_principal < 0 OR v_interest < 0 OR v_fees < 0 OR v_penalty < 0 OR v_close < 0
    THEN RAISE EXCEPTION 'Échéance d''avenant invalide'; END IF;
    IF v_open <> v_expected_open THEN RAISE EXCEPTION 'Incohérence du capital d''ouverture à l''échéance %', v_number; END IF;
    v_expected_open := v_close;
    v_previous_due := (v->>'due_date')::date;
  END LOOP;
  IF v_number <> jsonb_array_length(p_installments) OR v_expected_open <> 0 THEN
    RAISE EXCEPTION 'Le nouvel échéancier doit amortir intégralement le capital restant dû';
  END IF;

  -- Supersede first because only one active version is allowed per loan.
  UPDATE public.loan_schedule_versions SET status = 'superseded', effective_until = p_effective_from - 1 WHERE id = v_current.id;
  INSERT INTO public.loan_schedule_versions(
    organization_id, loan_id, version_number, version_type, status, effective_from,
    amendment_reference, amendment_reason, approved_at, approved_by, created_by
  ) VALUES (
    p_organization_id, p_loan_id, v_version, 'amendment', 'active', p_effective_from,
    btrim(p_amendment_reference), btrim(p_amendment_reason), now(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_id;

  FOR v IN SELECT value FROM jsonb_array_elements(p_installments) ORDER BY (value->>'installment_number')::integer LOOP
    v_open := round((v->>'opening_principal')::numeric, 2);
    v_principal := round((v->>'principal_due')::numeric, 2);
    v_interest := round((v->>'interest_due')::numeric, 2);
    v_fees := round(coalesce((v->>'fees_due')::numeric, 0), 2);
    v_penalty := round(coalesce((v->>'penalty_due')::numeric, 0), 2);
    INSERT INTO public.loan_installments(
      organization_id, loan_id, installment_number, due_date, opening_principal,
      principal_due, interest_due, fees_due, penalty_due, total_due,
      closing_principal, status, schedule_version_id
    ) VALUES (
      p_organization_id, p_loan_id, (v->>'installment_number')::integer, (v->>'due_date')::date,
      v_open, v_principal, v_interest, v_fees, v_penalty,
      v_principal + v_interest + v_fees + v_penalty, v_open - v_principal, 'planned', v_id
    );
  END LOOP;

  UPDATE public.loans SET active_schedule_version_id = v_id, updated_at = now()
  WHERE id = p_loan_id AND organization_id = p_organization_id;
  PERFORM public.audit_event(
    p_organization_id, 'loan.schedule_amendment_created', 'loan_schedule_version', v_id, NULL,
    jsonb_build_object('loan_id', p_loan_id, 'version_number', v_version,
      'effective_from', p_effective_from, 'amendment_reference', p_amendment_reference)
  );
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb) TO authenticated;
