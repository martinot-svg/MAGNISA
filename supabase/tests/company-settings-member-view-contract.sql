DO $$
DECLARE
  v_viewdef text;
  v_options text[];
  v_policy_count integer;
BEGIN
  IF to_regclass('public.company_settings_member_view') IS NULL THEN
    RAISE EXCEPTION 'Permission-aware company settings view is missing';
  END IF;

  SELECT pg_get_viewdef('public.company_settings_member_view'::regclass, true)
    INTO v_viewdef;
  IF position('get_company_settings_member_read_model' IN v_viewdef) = 0 THEN
    RAISE EXCEPTION 'Company settings invoker view must use the permission-aware read model function';
  END IF;

  SELECT pg_get_functiondef('public.get_company_settings_member_read_model()'::regprocedure)
    INTO v_viewdef;
  IF position('is_org_member' IN v_viewdef) = 0
     OR position('has_org_permission' IN v_viewdef) = 0
     OR position('can_finance' IN v_viewdef) = 0
     OR position('can_identity' IN v_viewdef) = 0
     OR position('can_bank' IN v_viewdef) = 0
     OR position('auth.uid()' IN v_viewdef) = 0 THEN
    RAISE EXCEPTION 'Company settings read model must enforce identity, membership and permission-aware field masking';
  END IF;

  SELECT reloptions INTO v_options
  FROM pg_class
  WHERE oid = 'public.company_settings_member_view'::regclass;
  IF NOT COALESCE(
    v_options @> ARRAY['security_barrier=true']
    AND v_options @> ARRAY['security_invoker=true'],
    false
  ) THEN
    RAISE EXCEPTION 'Company settings view must use security_barrier and security_invoker';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_settings'
    AND policyname IN (
      'company_settings_admin_select',
      'company_settings_admin_insert',
      'company_settings_admin_update'
    );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Company settings base-table admin policies are incomplete';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'company_settings'
    AND policyname IN (
      'company_settings_admin_select_guard',
      'company_settings_admin_insert_guard',
      'company_settings_admin_update_guard'
    )
    AND permissive = 'RESTRICTIVE';
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Restrictive admin guards must prevent broader legacy policies from exposing raw settings';
  END IF;

  IF has_table_privilege('anon', 'public.company_settings_member_view', 'SELECT') THEN
    RAISE EXCEPTION 'Anonymous users must not read company settings view';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.company_settings_member_view', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated users must be able to query the permission-aware view';
  END IF;
END;
$$;
