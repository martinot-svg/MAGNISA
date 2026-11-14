-- MGMail: safe, read-only schema contract after migrations (also runnable in production).
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/mgmail-internal-schema-contract.sql
-- This file intentionally performs no DML, DDL or privilege changes.
DO $mgmail_check$
DECLARE
  v_missing text;
BEGIN
  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261114103000', '20261114103100', '20261114103200')
  ) <> 3 THEN
    RAISE EXCEPTION 'MGMail: one or more approved migration versions are missing';
  END IF;

  SELECT string_agg(expected.name, ', ' ORDER BY expected.name)
    INTO v_missing
  FROM (
    VALUES ('mgmail_internal_namespaces'), ('mgmail_internal_mailboxes'),
           ('mgmail_internal_messages'), ('mgmail_internal_mailbox_grants'),
           ('mgmail_internal_message_reads')
  ) AS expected(name)
  LEFT JOIN pg_catalog.pg_class c
    ON c.oid = to_regclass('public.' || expected.name)
  WHERE c.oid IS NULL OR c.relkind NOT IN ('r','p') OR NOT c.relrowsecurity;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'MGMail: table missing or RLS disabled: %', v_missing;
  END IF;

  SELECT string_agg(expected.tablename || ':' || expected.policyname, ', ' ORDER BY expected.tablename)
    INTO v_missing
  FROM (
    VALUES
      ('mgmail_internal_namespaces','mgmail_namespaces_select'),
      ('mgmail_internal_namespaces','mgmail_namespaces_insert'),
      ('mgmail_internal_mailboxes','mgmail_mailboxes_select'),
      ('mgmail_internal_mailboxes','mgmail_mailboxes_insert'),
      ('mgmail_internal_mailboxes','mgmail_mailboxes_update'),
      ('mgmail_internal_messages','mgmail_messages_select'),
      ('mgmail_internal_messages','mgmail_messages_insert'),
      ('mgmail_internal_messages','mgmail_messages_mark_read'),
      ('mgmail_internal_mailbox_grants','mgmail_grants_read'),
      ('mgmail_internal_mailbox_grants','mgmail_grants_create'),
      ('mgmail_internal_mailbox_grants','mgmail_grants_change'),
      ('mgmail_internal_message_reads','mgmail_reads_own'),
      ('mgmail_internal_message_reads','mgmail_reads_insert_own')
  ) AS expected(tablename,policyname)
  LEFT JOIN pg_catalog.pg_policies p ON p.schemaname='public'
    AND p.tablename=expected.tablename AND p.policyname=expected.policyname
  WHERE p.policyname IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'MGMail: required policies missing: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.mgmail_can_send_internal(uuid,uuid,uuid)')
      AND NOT prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.mgmail_has_internal_access(uuid,uuid,text)')
      AND NOT prosecdef
  ) THEN
    RAISE EXCEPTION 'MGMail: permissions RPCs must exist and be SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', 'public.mgmail_can_send_internal(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mgmail_has_internal_access(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mgmail_can_send_internal(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mgmail_has_internal_access(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MGMail: execution grants for anonymous or authenticated role are incorrect';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES ('mgmail_internal_namespaces'),('mgmail_internal_mailboxes'),
             ('mgmail_internal_messages'),('mgmail_internal_mailbox_grants'),
             ('mgmail_internal_message_reads')
    ) AS expected(name)
    WHERE has_table_privilege('anon','public.' || expected.name,'SELECT')
       OR has_table_privilege('anon','public.' || expected.name,'INSERT')
  ) THEN
    RAISE EXCEPTION 'MGMail: anonymous role must not read or insert internal mail';
  END IF;

  SELECT string_agg(expected.trigger_name, ', ' ORDER BY expected.trigger_name)
    INTO v_missing
  FROM (
    VALUES
      ('organization_members','trg_mgmail_suspend_departed_member'),
      ('organization_members','trg_mgmail_suspend_shared_grants'),
      ('mgmail_internal_messages','trg_mgmail_notify_internal_message')
  ) AS expected(table_name,trigger_name)
  LEFT JOIN pg_catalog.pg_trigger t
    ON t.tgrelid=to_regclass('public.' || expected.table_name)
    AND t.tgname=expected.trigger_name
    AND t.tgenabled IN ('O','A')
  WHERE t.oid IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'MGMail: essential notifications or access-revocation triggers missing: %', v_missing;
  END IF;

  RAISE NOTICE 'PASS MGMail: three versions, five RLS tables, required policies, invoker RPCs and revocation/notification triggers';
END
$mgmail_check$;
