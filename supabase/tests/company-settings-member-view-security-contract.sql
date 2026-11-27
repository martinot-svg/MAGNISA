DO $contract$
DECLARE
  v_view_options text[];
  v_function_def text;
  v_function_config text[];
BEGIN
  SELECT reloptions INTO v_view_options
  FROM pg_class WHERE oid='public.company_settings_member_view'::regclass;
  IF NOT ('security_invoker=true'=ANY(coalesce(v_view_options,ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Company settings member view must execute with invoker privileges';
  END IF;

  SELECT p.proconfig,pg_get_functiondef(p.oid)
  INTO STRICT v_function_config,v_function_def
  FROM pg_proc p
  WHERE p.oid='public.get_company_settings_member_read_model()'::regprocedure
    AND p.prosecdef;

  IF v_function_def NOT ILIKE '%auth.uid()%'
     OR v_function_def NOT ILIKE '%is_org_member%'
     OR v_function_def NOT ILIKE '%can_bank%'
     OR v_function_def NOT ILIKE '%can_identity%'
     OR v_function_def NOT ILIKE '%can_fiscal%' THEN
    RAISE EXCEPTION 'Member read model must enforce identity, membership and field-level permissions';
  END IF;

  IF has_function_privilege('anon','public.get_company_settings_member_read_model()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_company_settings_member_read_model()','EXECUTE')
     OR has_table_privilege('anon','public.company_settings_member_view','SELECT')
     OR NOT has_table_privilege('authenticated','public.company_settings_member_view','SELECT') THEN
    RAISE EXCEPTION 'Member read model grants are not restricted to authenticated users';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.company_settings'::regclass)
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='company_settings'
         AND policyname='company_settings_admin_select_guard'
         AND permissive='RESTRICTIVE'
     ) THEN
    RAISE EXCEPTION 'Raw company settings must remain protected by restrictive owner/admin RLS';
  END IF;

  IF NOT (v_function_config @> ARRAY['search_path=pg_catalog, public']) THEN
    RAISE EXCEPTION 'Member read model SECURITY DEFINER function must use a fixed search_path';
  END IF;
END;
$contract$;
