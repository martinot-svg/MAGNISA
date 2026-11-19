-- MAGNIBOX IMAP sync schema contract. Read-only; safe on isolated replay and production.
DO $magnibox_sync_check$
DECLARE
  v_missing text;
  v_table text;
  v_rpc text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'magnibox_sync_outbox',
    'magnibox_imap_folder_state',
    'magnibox_imap_message_map'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL OR NOT (
      SELECT c.relrowsecurity
      FROM pg_catalog.pg_class c
      WHERE c.oid = to_regclass('public.' || v_table)
    ) THEN
      RAISE EXCEPTION 'MAGNIBOX sync: table missing or RLS disabled: %', v_table;
    END IF;

    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'MAGNIBOX sync: browser role has direct table access: %', v_table;
    END IF;

    IF NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'MAGNIBOX sync: service_role grants incomplete: %', v_table;
    END IF;
  END LOOP;

  SELECT string_agg(required.name, ', ' ORDER BY required.name)
    INTO v_missing
  FROM (VALUES
    ('magnibox_sync_outbox_dedupe_key_key'),
    ('magnibox_imap_map_uid_uidvalidity_uidx'),
    ('magnibox_imap_map_active_source_folder_uidx'),
    ('magnibox_imap_internal_folder_key_uidx'),
    ('magnibox_imap_internet_folder_key_uidx')
  ) AS required(name)
  LEFT JOIN pg_catalog.pg_class c ON c.relname = required.name
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.oid IS NULL OR n.oid IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'MAGNIBOX sync: required unique indexes missing: %', v_missing;
  END IF;

  FOREACH v_rpc IN ARRAY ARRAY[
    'public.magnibox_claim_sync_events(text,integer,integer)',
    'public.magnibox_complete_sync_event(uuid,uuid)',
    'public.magnibox_fail_sync_event(uuid,uuid,text,boolean,integer,integer)'
  ] LOOP
    IF to_regprocedure(v_rpc) IS NULL THEN
      RAISE EXCEPTION 'MAGNIBOX sync: RPC missing: %', v_rpc;
    END IF;
    IF has_function_privilege('anon', v_rpc, 'EXECUTE')
      OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'MAGNIBOX sync: RPC grants incorrect: %', v_rpc;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(v_rpc)) THEN
      RAISE EXCEPTION 'MAGNIBOX sync: worker RPC must be SECURITY DEFINER: %', v_rpc;
    END IF;
  END LOOP;

  SELECT string_agg(required.trigger_name, ', ' ORDER BY required.trigger_name)
    INTO v_missing
  FROM (VALUES
    ('mgmail_internal_messages','magnibox_internal_message_sync_outbox'),
    ('orbit_external_messages','magnibox_external_message_sync_outbox'),
    ('magnibox_imap_folder_state','magnibox_imap_folder_identity_guard'),
    ('magnibox_imap_message_map','magnibox_imap_message_map_source_guard')
  ) AS required(table_name, trigger_name)
  LEFT JOIN pg_catalog.pg_trigger t
    ON t.tgrelid = to_regclass('public.' || required.table_name)
   AND t.tgname = required.trigger_name
   AND t.tgenabled IN ('O','A')
   AND NOT t.tgisinternal
  WHERE t.oid IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'MAGNIBOX sync: required integrity/outbox triggers missing: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.magnibox_sync_outbox'::regclass
      AND attname = 'dedupe_key' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.magnibox_imap_message_map'::regclass
      AND attname = 'delete_confirmed_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX sync: dedupe or tombstone columns missing';
  END IF;

  RAISE NOTICE 'PASS MAGNIBOX IMAP sync: RLS, service-only access, fenced worker RPCs, unique mapping indexes, source guards and transactional outbox triggers';
END
$magnibox_sync_check$;
