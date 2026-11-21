-- Contract for the outbound request fingerprint and attachment-bound idempotency.
DO $magnibox_fingerprint$
DECLARE
  v_fn oid := to_regprocedure('public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,text,uuid,uuid,integer)');
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261121123100'
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX outbound request fingerprint migration absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orbit_external_messages'
      AND column_name='request_fingerprint' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX outbound request fingerprint column missing';
  END IF;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'Fingerprint-aware outbound reservation RPC missing'; END IF;
  IF NOT has_function_privilege('service_role',v_fn,'EXECUTE')
    OR has_function_privilege('authenticated',v_fn,'EXECUTE')
    OR has_function_privilege('anon',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Fingerprint reservation RPC permissions are unsafe';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_def;
  IF pg_catalog.strpos(v_def,'p_request_fingerprint')=0
    OR pg_catalog.strpos(v_def,'request_fingerprint')=0
    OR pg_catalog.strpos(v_def,'outbound request key already exists')=0
    OR pg_catalog.strpos(v_def,'outbound quota exceeded')=0 THEN
    RAISE EXCEPTION 'Reservation RPC does not bind fingerprint before quota accounting';
  END IF;
  IF to_regprocedure('public.orbit_reserve_magnibox_outbound(uuid,uuid,text,text[],text,text,uuid,uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy fingerprint-free reservation RPC remains callable';
  END IF;
  RAISE NOTICE 'PASS MAGNIBOX outbound fingerprint: immutable request binding and service-role-only reservation';
END
$magnibox_fingerprint$;
