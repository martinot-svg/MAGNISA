-- MAGNIBOX encrypted IMAP credential vault schema contract.
DO $credential_vault_contract$
DECLARE
  v_table regclass := to_regclass('public.magnibox_imap_credentials');
  v_policy_count integer;
BEGIN
  IF v_table IS NULL THEN RAISE EXCEPTION 'MAGNIBOX credential vault table missing'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_table) THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault RLS is disabled';
  END IF;
  IF has_table_privilege('anon', v_table, 'SELECT')
    OR has_table_privilege('anon', v_table, 'INSERT')
    OR has_table_privilege('authenticated', v_table, 'SELECT')
    OR has_table_privilege('authenticated', v_table, 'INSERT')
    OR has_table_privilege('authenticated', v_table, 'UPDATE')
    OR has_table_privilege('authenticated', v_table, 'DELETE') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault is accessible to browser roles';
  END IF;
  IF NOT has_table_privilege('service_role', v_table, 'SELECT')
    OR NOT has_table_privilege('service_role', v_table, 'INSERT')
    OR NOT has_table_privilege('service_role', v_table, 'UPDATE') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault service_role grants incomplete';
  END IF;
  SELECT count(*) INTO v_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename = 'magnibox_imap_credentials';
  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault must not define browser-facing policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname='public' AND indexname='magnibox_imap_credentials_one_active_uidx') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault active-version uniqueness missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid=v_table AND conname='magnibox_imap_credentials_mailbox_org_fk') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault tenant/mailbox foreign key missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid=v_table AND tgname='magnibox_imap_credentials_immutable' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault immutability trigger missing';
  END IF;
  IF has_function_privilege('anon','public.magnibox_store_imap_credential(uuid,uuid,smallint,text,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_store_imap_credential(uuid,uuid,smallint,text,text,text,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_get_active_imap_credential(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_get_active_imap_credential(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.magnibox_revoke_active_imap_credential(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.magnibox_revoke_active_imap_credential(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault RPCs are executable by browser roles';
  END IF;
  IF NOT has_function_privilege('service_role','public.magnibox_store_imap_credential(uuid,uuid,smallint,text,text,text,text,text,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_get_active_imap_credential(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.magnibox_revoke_active_imap_credential(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'MAGNIBOX credential vault service_role RPC grants incomplete';
  END IF;
    RAISE NOTICE 'PASS MAGNIBOX credential vault: encrypted-envelope schema, tenant mailbox FK, no browser access, single active version and immutable envelope';
END;
$credential_vault_contract$;
