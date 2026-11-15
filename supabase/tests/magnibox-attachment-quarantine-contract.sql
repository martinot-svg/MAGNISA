-- Read-only contract for MAGNIBOX attachment quarantine and scan state.
DO $magnibox_attachments$
DECLARE
  v_table oid := to_regclass('public.orbit_external_message_attachments');
  v_bucket boolean;
  v_policy_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261115120000'
  ) THEN
    RAISE EXCEPTION 'MAGNIBOX attachment quarantine migration absent';
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'MAGNIBOX attachment metadata table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=v_table) THEN
    RAISE EXCEPTION 'MAGNIBOX attachment RLS must be enabled';
  END IF;
  SELECT NOT public INTO v_bucket FROM storage.buckets WHERE id='magnibox-attachments';
  IF coalesce(v_bucket,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MAGNIBOX attachment bucket must exist and remain private';
  END IF;
  IF NOT has_table_privilege('authenticated',v_table,'SELECT')
    OR has_table_privilege('authenticated',v_table,'INSERT')
    OR has_table_privilege('authenticated',v_table,'UPDATE')
    OR has_table_privilege('authenticated',v_table,'DELETE')
    OR has_table_privilege('anon',v_table,'SELECT') THEN
    RAISE EXCEPTION 'Browser roles must have read-only metadata access at most';
  END IF;
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
    AND policyname ILIKE '%magnibox%';
  IF v_policy_count > 0 THEN
    RAISE EXCEPTION 'No browser Storage policy may expose MAGNIBOX quarantined objects';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='orbit_external_message_attachments'
      AND policyname='orbit_external_attachment_read'
      AND cmd='SELECT'
  ) THEN
    RAISE EXCEPTION 'Authenticated attachment read policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orbit_external_message_attachments'
      AND column_name='scan_lease_token'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orbit_external_message_attachments'
      AND column_name='scan_attempts'
  ) THEN
    RAISE EXCEPTION 'Attachment scan lease/fencing columns missing';
  END IF;
  RAISE NOTICE 'PASS MAGNIBOX attachment quarantine: private bucket, RLS, no browser object access, scan fencing';
END
$magnibox_attachments$;
