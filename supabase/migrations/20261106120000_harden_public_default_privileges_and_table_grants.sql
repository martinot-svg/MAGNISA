begin;

-- These privileges bypass or circumvent the intended row-level access model.
-- Application users must never be able to truncate tables or create triggers.
revoke truncate, trigger, references on all tables in schema public
  from public, anon, authenticated;

-- Keep future tables created by either migration owner equally restricted.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from public, anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke truncate, trigger, references on tables from public, anon, authenticated;

-- Prevent newly created public RPC functions from becoming callable by anon
-- unless a later migration explicitly grants that access.
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon, public;

commit;
