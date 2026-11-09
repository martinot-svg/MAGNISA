DO $test$
DECLARE
  v_snapshotless_authenticated integer;
  v_snapshotless_anon integer;
  v_snapshot_aware_authenticated integer;
BEGIN
  SELECT count(*) INTO v_snapshotless_authenticated
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='create_payslip'
    AND NOT ('p_fiscal_snapshot'=ANY(coalesce(p.proargnames,ARRAY[]::text[])))
    AND has_function_privilege('authenticated',p.oid,'EXECUTE');

  SELECT count(*) INTO v_snapshotless_anon
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='create_payslip'
    AND has_function_privilege('anon',p.oid,'EXECUTE');

  SELECT count(*) INTO v_snapshot_aware_authenticated
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='create_payslip'
    AND 'p_fiscal_snapshot'=ANY(coalesce(p.proargnames,ARRAY[]::text[]))
    AND has_function_privilege('authenticated',p.oid,'EXECUTE');

  IF v_snapshotless_authenticated<>0 THEN
    RAISE EXCEPTION 'Snapshot-less create_payslip overloads remain executable by authenticated: %',v_snapshotless_authenticated;
  END IF;
  IF v_snapshotless_anon<>0 THEN
    RAISE EXCEPTION 'Anonymous execution of create_payslip is not allowed';
  END IF;
  IF v_snapshot_aware_authenticated<>1 THEN
    RAISE EXCEPTION 'Expected exactly one authenticated snapshot-aware create_payslip overload, got %',v_snapshot_aware_authenticated;
  END IF;
END;
$test$;

SELECT 'PASS payroll snapshot RPC privileges' AS result;
