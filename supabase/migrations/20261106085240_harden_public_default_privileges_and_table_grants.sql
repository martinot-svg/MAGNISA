begin;

revoke truncate, trigger, references on all tables in schema public
  from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

commit;