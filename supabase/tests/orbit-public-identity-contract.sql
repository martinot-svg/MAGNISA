-- Read-only contract after replay of Orbit public identity migration.
DO $orbit_identity_contract$
DECLARE missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261114122000') THEN
    RAISE EXCEPTION 'Orbit public identity migration not replayed';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN (
    to_regclass('public.orbit_public_identities'),
    to_regclass('public.orbit_external_mailbox_access'),
    to_regclass('public.orbit_external_messages')
  ) AND relrowsecurity)<>3 THEN
    RAISE EXCEPTION 'Orbit public mail RLS tables missing';
  END IF;
  IF has_table_privilege('anon','public.orbit_public_identities','SELECT')
   OR has_table_privilege('anon','public.orbit_external_messages','SELECT')
   OR has_table_privilege('anon','public.orbit_external_mailbox_access','SELECT') THEN
    RAISE EXCEPTION 'Anonymous users can inspect private Internet mailbox';
  END IF;
  IF has_table_privilege('authenticated','public.orbit_public_identities','INSERT')
   OR has_table_privilege('authenticated','public.orbit_public_identities','UPDATE')
   OR has_table_privilege('authenticated','public.orbit_public_identities','DELETE')
   OR has_table_privilege('authenticated','public.orbit_external_messages','INSERT')
   OR has_table_privilege('authenticated','public.orbit_external_messages','UPDATE')
   OR has_table_privilege('authenticated','public.orbit_external_messages','DELETE')
   OR has_table_privilege('authenticated','public.orbit_external_mailbox_access','INSERT')
   OR has_table_privilege('authenticated','public.orbit_external_mailbox_access','UPDATE')
   OR has_table_privilege('authenticated','public.orbit_external_mailbox_access','DELETE') THEN
    RAISE EXCEPTION 'Browser users must never activate public mail or edit external grants';
  END IF;
  SELECT string_agg(expected.policy,', ') INTO missing FROM (
    VALUES
      ('orbit_public_identities','orbit_public_identities_read'),
      ('orbit_external_mailbox_access','orbit_external_access_read'),
      ('orbit_external_messages','orbit_external_messages_read')
  ) expected(tab,policy)
  LEFT JOIN pg_policies p ON p.schemaname='public'
    AND p.tablename=expected.tab AND p.policyname=expected.policy
  WHERE p.policyname IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing RLS policies: %',missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.orbit_public_identities'::regclass
      AND tgname='trg_orbit_identity_activation' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.mgmail_domain_requests'::regclass
      AND tgname='trg_orbit_domain_unverified' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Provider activation/domain-revocation guard trigger missing';
  END IF;
  IF NOT has_function_privilege('authenticated',
      'public.orbit_can_public_mail_access(uuid,uuid,text)','EXECUTE')
   OR has_function_privilege('anon',
      'public.orbit_can_public_mail_access(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Wrong mail permission function grants';
  END IF;
  RAISE NOTICE 'PASS Orbit public mail identity RLS, provider activation gate and revocation';
END
$orbit_identity_contract$;
