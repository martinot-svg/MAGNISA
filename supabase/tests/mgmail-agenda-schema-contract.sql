-- MGMail calendar security and release contract: read-only, no business data touched.
DO $mgmail_agenda_check$
DECLARE missing_policies text;
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version IN ('20261114110000','20261114110100')) <> 2 THEN
    RAISE EXCEPTION 'MGMail agenda: approved migration versions absent';
  END IF;
  IF to_regclass('public.mgmail_agenda_events') IS NULL THEN
    RAISE EXCEPTION 'MGMail agenda: event table absent';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
          WHERE oid=to_regclass('public.mgmail_agenda_events')) THEN
    RAISE EXCEPTION 'MGMail agenda: event RLS not enabled';
  END IF;
  SELECT string_agg(p.name,', ' ORDER BY p.name)
    INTO missing_policies
  FROM (VALUES ('mgmail_agenda_read'),('mgmail_agenda_create'),('mgmail_agenda_edit')) p(name)
  LEFT JOIN pg_catalog.pg_policies actual
    ON actual.schemaname='public' AND actual.tablename='mgmail_agenda_events'
      AND actual.policyname=p.name
  WHERE actual.policyname IS NULL;
  IF missing_policies IS NOT NULL THEN
    RAISE EXCEPTION 'MGMail agenda: missing policies %',missing_policies;
  END IF;
  IF has_table_privilege('anon','public.mgmail_agenda_events','SELECT')
    OR has_table_privilege('anon','public.mgmail_agenda_events','INSERT')
    OR has_table_privilege('anon','public.mgmail_agenda_events','UPDATE') THEN
    RAISE EXCEPTION 'MGMail agenda: anonymous table privileges not revoked';
  END IF;
  -- INSERT is granted by column, not at table level.
  IF NOT has_table_privilege('authenticated','public.mgmail_agenda_events','SELECT')
    OR NOT has_column_privilege('authenticated','public.mgmail_agenda_events','title','INSERT')
    OR NOT has_column_privilege('authenticated','public.mgmail_agenda_events','status','UPDATE') THEN
    RAISE EXCEPTION 'MGMail agenda: authenticated API privileges absent';
  END IF;
  IF to_regprocedure('public.run_mgmail_agenda_reminders(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'MGMail agenda: reminder RPC absent';
  END IF;
  IF has_function_privilege('anon','public.run_mgmail_agenda_reminders(timestamptz)','EXECUTE')
    OR has_function_privilege('authenticated','public.run_mgmail_agenda_reminders(timestamptz)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.run_mgmail_agenda_reminders(timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'MGMail agenda: reminder RPC role privileges invalid';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname='trg_mgmail_agenda_validate_zone'
      AND tgrelid=to_regclass('public.mgmail_agenda_events')
      AND tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'MGMail agenda: time-zone verification trigger absent';
  END IF;
  RAISE NOTICE 'PASS MGMail agenda: migrations, RLS, anonymous denial, server-only reminders, time zones';
END
$mgmail_agenda_check$;
