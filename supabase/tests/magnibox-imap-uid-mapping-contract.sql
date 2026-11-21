-- MAGNIBOX durable IMAP UID mapping RPC security and precision contract.
DO $imap_uid_mapping_contract$
DECLARE
  v_table regclass := to_regclass('public.magnibox_imap_message_map');
  v_folder regclass := to_regclass('public.magnibox_imap_folder_state');
  v_result text;
BEGIN
  IF v_table IS NULL OR v_folder IS NULL THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping base tables are missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP message mapping RLS is disabled';
  END IF;

  IF has_table_privilege('anon',v_table,'SELECT')
    OR has_table_privilege('authenticated',v_table,'SELECT')
    OR has_table_privilege('authenticated',v_table,'INSERT')
    OR has_table_privilege('authenticated',v_table,'UPDATE')
    OR has_table_privilege('authenticated',v_table,'DELETE') THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping table is accessible to browser roles';
  END IF;

  IF NOT has_table_privilege('service_role',v_table,'SELECT')
    OR NOT has_table_privilege('service_role',v_table,'INSERT')
    OR NOT has_table_privilege('service_role',v_table,'UPDATE') THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping service_role grants are incomplete';
  END IF;

  IF has_function_privilege('anon','public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_tombstone_imap_message_mapping(uuid,text,uuid,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_tombstone_imap_message_mapping(uuid,text,uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping RPCs are executable by browser roles';
  END IF;

  IF NOT has_function_privilege('service_role','public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_tombstone_imap_message_mapping(uuid,text,uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping service_role RPC grants are incomplete';
  END IF;

  SELECT pg_get_function_result('public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid)'::regprocedure)
    INTO v_result;
  IF v_result NOT LIKE '%uidvalidity text%'
    OR v_result NOT LIKE '%imap_uid text%'
    OR v_result NOT LIKE '%imap_modseq text%'
    OR v_result NOT LIKE '%sync_version text%' THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping read RPC must return BIGINT fields as text';
  END IF;

  SELECT pg_get_function_result('public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb)'::regprocedure)
    INTO v_result;
  IF v_result NOT LIKE '%sync_version text%' THEN
    RAISE EXCEPTION 'MAGNIBOX IMAP mapping write RPC must return sync_version as text';
  END IF;

  RAISE NOTICE 'PASS MAGNIBOX IMAP UID mapping: server-only RPCs, tenant table isolation, BIGINT precision preserved';
END;
$imap_uid_mapping_contract$;
