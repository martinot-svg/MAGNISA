-- Prevent unauthenticated callers from invoking exposed RPCs by default.
-- Authenticated/service_role grants are preserved and remain subject to each
-- function's own authorization checks.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Keep future functions created by the migration owner private by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Trigger helper should not depend on the caller's mutable search_path.
ALTER FUNCTION public.magnisa_journal_balance_guard()
  SET search_path = public, pg_temp;

-- This archive is private and has no row policies by design. Remove direct
-- API grants; privileged server-side workflows can continue using service_role.
REVOKE ALL PRIVILEGES ON TABLE public.payroll_legal_documents
  FROM anon, authenticated;
