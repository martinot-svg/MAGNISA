-- Regression test: activation must reject a second validated payroll rule
-- with the exact same effective_from date. All fixtures are rolled back.
begin;

do $test$
declare
  v_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_existing_rule uuid := gen_random_uuid();
  v_candidate_rule uuid := gen_random_uuid();
  v_error text;
  v_existing_status text;
  v_candidate_status text;
  v_start date := current_date;
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    v_owner, 'authenticated', 'authenticated',
    v_owner::text || '@payroll-date-conflict.test', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.organizations(id, name)
  values (v_org, 'Payroll activation date conflict test');

  insert into public.organization_members(organization_id, user_id, role, status)
  values (v_org, v_owner, 'owner', 'active');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );

  insert into public.payroll_rule_sets (
    id, organization_id, name, effective_from, effective_to, status,
    cnaps_employee_rate, cnaps_employer_rate,
    health_employee_rate, health_employer_rate, fmfp_employer_rate,
    cnaps_monthly_ceiling, health_monthly_ceiling,
    irsa_brackets, irsa_minimum, rounding_policy, legal_reference
  ) values (
    v_existing_rule, v_org, 'Existing validated test rule', v_start, null, 'pending_review',
    0.01, 0.13, 0.02, 0.08, 0.01,
    2400000, 1600000,
    '[{"up_to":350000,"rate":0},{"up_to":400000,"rate":0.05},{"up_to":500000,"rate":0.10},{"up_to":600000,"rate":0.15},{"up_to":4000000,"rate":0.20},{"up_to":null,"rate":0.25}]'::jsonb,
    3000, 'floor_100', 'TEST ONLY'
  );

  perform set_config('app.payroll_rule_activation', 'on', true);
  update public.payroll_rule_sets
     set status = 'validated', reviewed_by = v_owner, reviewed_at = now()
   where id = v_existing_rule and organization_id = v_org;
  perform set_config('app.payroll_rule_activation', 'off', true);

  insert into public.payroll_rule_sets (
    id, organization_id, name, effective_from, effective_to, status,
    cnaps_employee_rate, cnaps_employer_rate,
    health_employee_rate, health_employer_rate, fmfp_employer_rate,
    cnaps_monthly_ceiling, health_monthly_ceiling,
    irsa_brackets, irsa_minimum, rounding_policy, legal_reference
  ) values (
    v_candidate_rule, v_org, 'Conflicting candidate test rule', v_start, null, 'pending_review',
    0.01, 0.13, 0.02, 0.08, 0.01,
    2400000, 1600000,
    '[{"up_to":350000,"rate":0},{"up_to":400000,"rate":0.05},{"up_to":500000,"rate":0.10},{"up_to":600000,"rate":0.15},{"up_to":4000000,"rate":0.20},{"up_to":null,"rate":0.25}]'::jsonb,
    3000, 'floor_100', 'TEST ONLY'
  );

  begin
    perform public.activate_payroll_rule(v_org, v_candidate_rule);
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is null then
    raise exception 'TEST FAILED: activation accepted two validated rules with the same effective_from date';
  end if;

  if v_error not like 'Une règle validée existe déjà avec cette date de début%' then
    raise exception 'TEST FAILED: unexpected activation error: %', v_error;
  end if;

  select status into v_existing_status
    from public.payroll_rule_sets
   where id = v_existing_rule and organization_id = v_org;

  select status into v_candidate_status
    from public.payroll_rule_sets
   where id = v_candidate_rule and organization_id = v_org;

  if v_existing_status <> 'validated' or v_candidate_status <> 'pending_review' then
    raise exception 'TEST FAILED: conflicting activation changed a payroll rule status';
  end if;
end
$test$;

rollback;


-- The SECURITY DEFINER activation RPC must use a pinned, trusted search_path.
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'activate_payroll_rule'
       AND p.proargtypes = '2950 2950'::oidvector
       AND p.prosecdef
       AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: activate_payroll_rule must be SECURITY DEFINER with search_path=pg_catalog, public';
  END IF;
END
$assert$;
