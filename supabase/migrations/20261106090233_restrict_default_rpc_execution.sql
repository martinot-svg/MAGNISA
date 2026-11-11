begin;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

revoke execute on function public.auto_convert_won_prospect()
  from public, anon, authenticated;

commit;