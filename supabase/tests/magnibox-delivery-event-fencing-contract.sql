-- Read-only contract for serialized and ambiguity-safe SMTP delivery receipts.
DO $magnibox_delivery$
DECLARE
  v_fn oid := to_regprocedure('public.orbit_apply_magnibox_delivery_event(text,text)');
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261115170000'
  ) THEN RAISE EXCEPTION 'MAGNIBOX delivery event migration absent'; END IF;
  IF v_fn IS NULL THEN RAISE EXCEPTION 'MAGNIBOX delivery event RPC missing'; END IF;
  IF NOT has_function_privilege('service_role',v_fn,'EXECUTE')
    OR has_function_privilege('authenticated',v_fn,'EXECUTE')
    OR has_function_privilege('anon',v_fn,'EXECUTE')
    OR has_function_privilege('public',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Delivery event RPC privileges are not restricted to service_role';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_def;
  IF v_def NOT ILIKE '%pg_advisory_xact_lock%'
    OR v_def NOT ILIKE '%ambiguous%'
    OR v_def NOT ILIKE '%direction = ''outgoing''%' THEN
    RAISE EXCEPTION 'Delivery event RPC must lock queue IDs and reject ambiguous outgoing matches';
  END IF;
  RAISE NOTICE 'PASS MAGNIBOX delivery receipts: transaction lock, ambiguity guard, service-role boundary';
END
$magnibox_delivery$;
