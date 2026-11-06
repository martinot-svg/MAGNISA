begin;

-- These privileges bypass or circumvent the intended row-level access model.
-- Application users must never be able to truncate tables or create triggers.
revoke truncate, trigger, references on all tables in schema public
  from public, anon, authenticated;

-- Migrations run as postgres; keep future objects created by that role restricted.
-- Supabase-managed role supabase_admin is not alterable by the migration role.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

commit;
