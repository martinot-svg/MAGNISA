-- magnibox: safe, read-only schema contract after migrations (also runnable in production).
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/magnibox-internal-schema-contract.sql
-- This file intentionally performs no DML, DDL or privilege changes.
DO $magnibox_check$
DECLARE
  v_missing text;
BEGIN
  IF (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
    WHERE version IN ('20261114103000', '20261114103100', '20261114103200', '20261116150000', '20261116160000', '20261116161000', '20261117100000')
  ) <> 7 THEN
    RAISE EXCEPTION 'magnibox: one or more approved migration versions are missing';
  END IF;

  SELECT string_agg(expected.name, ', ' ORDER BY expected.name)
    INTO v_missing
  FROM (
    VALUES ('magnibox_internal_namespaces'), ('magnibox_internal_mailboxes'),
           ('magnibox_internal_messages'), ('magnibox_internal_mailbox_grants'),
           ('magnibox_internal_message_reads'), ('magnibox_internal_drafts'),
           ('magnibox_internal_folders'), ('magnibox_internal_message_folders')
  ) AS expected(name)
  LEFT JOIN pg_catalog.pg_class c
    ON c.oid = to_regclass('public.' || expected.name)
  WHERE c.oid IS NULL OR c.relkind NOT IN ('r','p') OR NOT c.relrowsecurity;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'magnibox: table missing or RLS disabled: %', v_missing;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname LIKE 'mgmail_internal_%'
  ) THEN
    RAISE EXCEPTION 'magnibox: legacy internal mail tables remain after compatibility migration';
  END IF;

  IF to_regprocedure('public.mgmail_can_send_internal(uuid,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.mgmail_has_internal_access(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'magnibox: legacy permission RPC names remain after compatibility migration';
  END IF;

  SELECT string_agg(expected.tablename || ':' || expected.policyname, ', ' ORDER BY expected.tablename)
    INTO v_missing
  FROM (
    VALUES
      ('magnibox_internal_namespaces','magnibox_namespaces_select'),
      ('magnibox_internal_namespaces','magnibox_namespaces_insert'),
      ('magnibox_internal_mailboxes','magnibox_mailboxes_select'),
      ('magnibox_internal_mailboxes','magnibox_mailboxes_insert'),
      ('magnibox_internal_mailboxes','magnibox_mailboxes_update'),
      ('magnibox_internal_messages','magnibox_messages_select'),
      ('magnibox_internal_messages','magnibox_messages_insert'),
      ('magnibox_internal_messages','magnibox_messages_mark_read'),
      ('magnibox_internal_mailbox_grants','magnibox_grants_read'),
      ('magnibox_internal_mailbox_grants','magnibox_grants_create'),
      ('magnibox_internal_mailbox_grants','magnibox_grants_change'),
      ('magnibox_internal_message_reads','magnibox_reads_own'),
      ('magnibox_internal_message_reads','magnibox_reads_insert_own'),
      ('magnibox_internal_drafts','magnibox_internal_drafts_select'),
      ('magnibox_internal_drafts','magnibox_internal_drafts_insert'),
      ('magnibox_internal_drafts','magnibox_internal_drafts_update'),
      ('magnibox_internal_drafts','magnibox_internal_drafts_delete'),
      ('magnibox_internal_folders','magnibox_internal_folders_select'),
      ('magnibox_internal_folders','magnibox_internal_folders_insert'),
      ('magnibox_internal_folders','magnibox_internal_folders_update'),
      ('magnibox_internal_folders','magnibox_internal_folders_delete'),
      ('magnibox_internal_message_folders','magnibox_internal_message_folders_select'),
      ('magnibox_internal_message_folders','magnibox_internal_message_folders_insert'),
      ('magnibox_internal_message_folders','magnibox_internal_message_folders_delete')
  ) AS expected(tablename,policyname)
  LEFT JOIN pg_catalog.pg_policies p ON p.schemaname='public'
    AND p.tablename=expected.tablename AND p.policyname=expected.policyname
  WHERE p.policyname IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'magnibox: required policies missing: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid='public.magnibox_internal_messages'::regclass
      AND attname='client_request_id' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid=to_regclass('public.magnibox_internal_messages_send_idempotency_uidx')
      AND indisunique
  ) THEN
    RAISE EXCEPTION 'magnibox: internal send idempotency column or unique index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.magnibox_send_internal_message(uuid,uuid,uuid,text,text,uuid)')
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'magnibox: idempotent send RPC must exist and be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon',
       'public.magnibox_send_internal_message(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.magnibox_send_internal_message(uuid,uuid,uuid,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'magnibox: idempotent send RPC grants are incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.magnibox_can_send_internal(uuid,uuid,uuid)')
      AND NOT prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.magnibox_has_internal_access(uuid,uuid,text)')
      AND NOT prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.magnibox_send_internal_draft(uuid)')
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'magnibox: permission RPCs must be invoker and guarded send RPCs must be definer';
  END IF;
  IF has_function_privilege('anon', 'public.magnibox_can_send_internal(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.magnibox_has_internal_access(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.magnibox_can_send_internal(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.magnibox_has_internal_access(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.magnibox_send_internal_draft(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.magnibox_send_internal_draft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'magnibox: execution grants for anonymous or authenticated role are incorrect';
  END IF;

  IF has_table_privilege('authenticated','public.magnibox_internal_messages','INSERT')
     OR has_column_privilege('authenticated','public.magnibox_internal_messages','organization_id','INSERT')
     OR has_column_privilege('authenticated','public.magnibox_internal_messages','sender_mailbox_id','INSERT')
     OR has_column_privilege('authenticated','public.magnibox_internal_messages','recipient_mailbox_id','INSERT')
     OR has_column_privilege('authenticated','public.magnibox_internal_messages','subject','INSERT')
     OR has_column_privilege('authenticated','public.magnibox_internal_messages','body_text','INSERT') THEN
    RAISE EXCEPTION 'magnibox: authenticated users must send through guarded RPCs, not direct table INSERT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES ('magnibox_internal_namespaces'),('magnibox_internal_mailboxes'),
             ('magnibox_internal_messages'),('magnibox_internal_mailbox_grants'),
             ('magnibox_internal_message_reads'),('magnibox_internal_drafts'),
             ('magnibox_internal_folders'),('magnibox_internal_message_folders')
    ) AS expected(name)
    WHERE has_table_privilege('anon','public.' || expected.name,'SELECT')
       OR has_table_privilege('anon','public.' || expected.name,'INSERT')
  ) THEN
    RAISE EXCEPTION 'magnibox: anonymous role must not read or insert internal mail';
  END IF;

  SELECT string_agg(expected.trigger_name, ', ' ORDER BY expected.trigger_name)
    INTO v_missing
  FROM (
    VALUES
      ('organization_members','trg_magnibox_suspend_departed_member'),
      ('organization_members','trg_magnibox_suspend_shared_grants'),
      ('magnibox_internal_messages','trg_magnibox_notify_internal_message'),
      ('magnibox_internal_drafts','trg_magnibox_touch_internal_draft')
  ) AS expected(table_name,trigger_name)
  LEFT JOIN pg_catalog.pg_trigger t
    ON t.tgrelid=to_regclass('public.' || expected.table_name)
    AND t.tgname=expected.trigger_name
    AND t.tgenabled IN ('O','A')
  WHERE t.oid IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'magnibox: essential notifications or access-revocation triggers missing: %', v_missing;
  END IF;

  RAISE NOTICE 'PASS magnibox: seven versions, eight RLS tables including private drafts and personal folders, idempotent send RPC, required policies, invoker permission RPCs, guarded definer send RPCs and access/notification triggers';
END
$magnibox_check$;
