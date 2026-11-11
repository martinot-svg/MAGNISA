REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER FUNCTION public.magnisa_journal_balance_guard() SET search_path = public, pg_temp;
DO $migration$
BEGIN
  IF to_regclass('public.payroll_legal_documents') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE public.payroll_legal_documents FROM anon, authenticated;
  END IF;
END
$migration$;