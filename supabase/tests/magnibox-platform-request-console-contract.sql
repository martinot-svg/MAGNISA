-- Read-only contract for the central Magnibox request-review boundary.
DO $magnibox_platform$
DECLARE
  v_list oid := to_regprocedure('public.magnibox_platform_mail_requests()');
  v_review oid := to_regprocedure('public.magnibox_platform_review_mail_request(text,uuid,text,text)');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261115100000') THEN
    RAISE EXCEPTION 'Magnibox platform review migration absent';
  END IF;
  IF v_list IS NULL OR v_review IS NULL THEN
    RAISE EXCEPTION 'Magnibox platform RPCs missing';
  END IF;
  IF NOT has_function_privilege('authenticated',v_list,'EXECUTE')
    OR NOT has_function_privilege('authenticated',v_review,'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated RPC entry points missing';
  END IF;
  IF has_function_privilege('anon',v_list,'EXECUTE')
    OR has_function_privilege('anon',v_review,'EXECUTE')
    OR has_function_privilege('public',v_list,'EXECUTE')
    OR has_function_privilege('public',v_review,'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous/public execution must be revoked';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_list)
    OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_review) THEN
    RAISE EXCEPTION 'Platform RPCs must enforce authorization inside SECURITY DEFINER functions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid='private.magnibox_platform_mail_audit'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Private audit table missing or RLS disabled';
  END IF;
  IF has_table_privilege('authenticated','private.magnibox_platform_mail_audit','SELECT')
    OR has_table_privilege('authenticated','private.magnibox_platform_mail_audit','INSERT')
    OR has_table_privilege('anon','private.magnibox_platform_mail_audit','SELECT') THEN
    RAISE EXCEPTION 'Platform audit must not be directly accessible to browser roles';
  END IF;
  RAISE NOTICE 'PASS Magnibox platform review: restricted RPCs, SECURITY DEFINER, private audit';
END
$magnibox_platform$;
