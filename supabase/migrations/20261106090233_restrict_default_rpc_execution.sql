begin;

-- Functions created by postgres must not become callable through PostgREST by
-- signed-in users unless the migration explicitly grants EXECUTE.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- This function is trigger-only. PostgreSQL does not require callers to have
-- EXECUTE on a trigger function when the trigger itself fires.
revoke execute on function public.auto_convert_won_prospect()
  from public, anon, authenticated;

commit;
