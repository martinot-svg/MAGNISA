-- Behavioral tests for the controlled payroll-rule archival RPC.
-- All fixtures and audit rows are rolled back at the end of this script.
BEGIN;

DO $test$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_sales uuid := gen_random_uuid();
  v_history uuid := gen_random_uuid();
  v_current uuid := gen_random_uuid();
  v_future uuid := gen_random_uuid();
  v_denied boolean := false;
  v_status text;
  v_effective_to date;
  v_audit_count integer;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', v_owner::text || '@test.invalid',
     '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (v_sales, 'authenticated', 'authenticated', v_sales::text || '@test.invalid',
     '', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  INSERT INTO public.organizations (id, name)
  VALUES (v_org, 'Payroll archival integration test');

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES
    (v_org, v_owner, 'owner', 'active'),
    (v_org, v_sales, 'sales', 'active');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('app.payroll_rule_activation', 'on', true);

  INSERT INTO public.payroll_rule_sets (
    id, organization_id, name, effective_from, effective_to, status,
    cnaps_employee_rate, cnaps_employer_rate,
    health_employee_rate, health_employer_rate, fmfp_employer_rate,
    cnaps_monthly_ceiling, health_monthly_ceiling,
    irsa_brackets, irsa_minimum, rounding_policy, legal_reference
  ) VALUES
    (v_history, v_org, 'TEST historical', current_date - 10, current_date - 2, 'draft',
     0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
     '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY'),
    (v_current, v_org, 'TEST current', current_date - 1, null, 'draft',
     0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
     '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY'),
    (v_future, v_org, 'TEST future', current_date + 10, null, 'draft',
     0, 0.01, 0, 0.05, 0.01, 1000000, 1000000,
     '[{"up_to":50000,"rate":0},{"rate":0.1}]'::jsonb, 0, 'floor_100', 'TEST ONLY');

  UPDATE public.payroll_rule_sets
     SET status = 'validated', reviewed_by = v_owner, reviewed_at = now()
   WHERE id IN (v_history, v_current, v_future);

  -- A historical validated rule can be archived without changing its dates.
  PERFORM public.archive_payroll_rule(v_org, v_history);
  SELECT status, effective_to INTO v_status, v_effective_to
    FROM public.payroll_rule_sets WHERE id = v_history;
  IF v_status <> 'archived' OR v_effective_to <> current_date - 2 THEN
    RAISE EXCEPTION 'TEST FAILED: historical rule was not archived with its historical end date';
  END IF;

  SELECT count(*) INTO v_audit_count
    FROM public.payroll_rule_change_log
   WHERE rule_id = v_history
     AND action = 'updated'
     AND new_values ->> 'status' = 'archived';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: archival audit event was not recorded exactly once';
  END IF;

  -- The rule governing today must never be archived.
  BEGIN
    PERFORM public.archive_payroll_rule(v_org, v_current);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%date actuelle%' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: current payroll rule was allowed to be archived';
  END IF;
  SELECT status INTO v_status FROM public.payroll_rule_sets WHERE id = v_current;
  IF v_status <> 'validated' THEN
    RAISE EXCEPTION 'TEST FAILED: current payroll rule changed after rejected archival';
  END IF;

  -- A future rule can be withdrawn while remaining in the immutable archive.
  PERFORM public.archive_payroll_rule(v_org, v_future);
  SELECT status, effective_to INTO v_status, v_effective_to
    FROM public.payroll_rule_sets WHERE id = v_future;
  IF v_status <> 'archived' OR v_effective_to <> current_date + 10 THEN
    RAISE EXCEPTION 'TEST FAILED: future rule archival did not preserve its effective date';
  END IF;

  -- A sales member cannot archive payroll rules.
  v_denied := false;
  PERFORM set_config('request.jwt.claim.sub', v_sales::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_sales, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM public.archive_payroll_rule(v_org, v_history);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%permission payroll.manage%' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'TEST FAILED: sales member was allowed to archive payroll rules';
  END IF;
END
$test$;

ROLLBACK;
