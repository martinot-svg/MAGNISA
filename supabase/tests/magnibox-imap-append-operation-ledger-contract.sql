-- MAGNIBOX durable APPEND operation ledger security and precision contract.
DO $imap_append_contract$
DECLARE
  v_table regclass := to_regclass('public.magnibox_imap_append_operations');
  v_result text;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP APPEND operation table is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP APPEND operation RLS is disabled';
  END IF;

  IF has_table_privilege('anon',v_table,'SELECT')
    OR has_table_privilege('authenticated',v_table,'SELECT')
    OR has_table_privilege('authenticated',v_table,'INSERT')
    OR has_table_privilege('authenticated',v_table,'UPDATE')
    OR has_table_privilege('authenticated',v_table,'DELETE') THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND operation table is accessible to browser roles';
  END IF;

  IF NOT has_table_privilege('service_role',v_table,'SELECT')
    OR NOT has_table_privilege('service_role',v_table,'INSERT')
    OR NOT has_table_privilege('service_role',v_table,'UPDATE') THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND operation service_role grants are incomplete';
  END IF;

  IF has_function_privilege('anon','public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_mark_imap_append_started(uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_mark_imap_append_started(uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_mark_imap_append_ambiguous(uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_mark_imap_append_ambiguous(uuid,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND ledger RPCs are executable by browser roles';
  END IF;

  IF NOT has_function_privilege('service_role','public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_mark_imap_append_started(uuid,uuid,uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_mark_imap_append_ambiguous(uuid,uuid,uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND ledger service_role RPC grants are incomplete';
  END IF;

  SELECT pg_get_function_result('public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid)'::regprocedure)
    INTO v_result;
  IF v_result NOT LIKE '%uidvalidity text%' OR v_result NOT LIKE '%imap_uid text%' THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND ledger read RPC must return BIGINT values as text';
  END IF;

  SELECT pg_get_function_result('public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint)'::regprocedure)
    INTO v_result;
  IF v_result NOT LIKE '%uidvalidity text%' OR v_result NOT LIKE '%imap_uid text%' THEN
    RAISE EXCEPTION 'MAGNIBOX APPEND confirmation RPC must return BIGINT values as text';
  END IF;

  RAISE NOTICE 'PASS MAGNIBOX APPEND ledger: tenant-scoped, lease-fenced, service-only RPCs, BIGINT precision preserved';
END;
$imap_append_contract$;
