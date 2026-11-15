-- Read-only contract for atomic MAGNIBOX outbound quota reservation.
DO $magnibox_quota$
DECLARE
  v_fn oid := to_regprocedure('public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,uuid,uuid,integer)');
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261115160000'
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX atomic quota migration absent';
  END IF;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'MAGNIBOX quota reservation RPC missing'; END IF;
  IF NOT has_function_privilege('service_role',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Service role cannot reserve outbound quota';
  END IF;
  IF has_function_privilege('authenticated',v_fn,'EXECUTE')
    OR has_function_privilege('anon',v_fn,'EXECUTE')
    OR has_function_privilege('public',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Browser/public roles must not reserve outbound quota';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_fn) THEN
    RAISE EXCEPTION 'Quota reservation must enforce its own transaction boundary';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_def;
  IF pg_catalog.strpos(v_def, 'outbound request key already exists') = 0
    OR pg_catalog.strpos(v_def, 'outbound quota exceeded') = 0
    OR pg_catalog.strpos(v_def, 'outbound request key already exists') > pg_catalog.strpos(v_def, 'outbound quota exceeded') THEN
    RAISE EXCEPTION 'Idempotent retry must be resolved before quota evaluation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_fn
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%pg_advisory_xact_lock%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%orbit_external_messages%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%outbound quota exceeded%'
  ) THEN
    RAISE EXCEPTION 'Quota reservation must lock, count and reject over-limit requests';
  END IF;
  RAISE NOTICE 'PASS MAGNIBOX outbound quota: transaction lock, atomic insert, service-role boundary';
END
$magnibox_quota$;
