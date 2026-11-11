-- Local replay compatibility only: the historical production prerequisite was
-- created before the tracked migration baseline and was later removed by 0015.
-- Preserve the exact production SQL in archive_20261009091913_0008_email_verification.sql.
DO $compat$
BEGIN
  IF to_regclass('public.email_verifications') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE INDEX IF NOT EXISTS email_verifications_user_created_idx ON public.email_verifications(user_id,created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS email_verifications_email_created_idx ON public.email_verifications(lower(email),created_at DESC)';
    EXECUTE 'REVOKE ALL ON TABLE public.email_verifications FROM anon, authenticated';
  END IF;
END
$compat$;
