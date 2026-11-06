do $$
declare
  default_acl text;
begin
  if has_function_privilege('authenticated', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by anon';
  end if;

  select d.defaclacl::text into default_acl
  from pg_default_acl d
  join pg_namespace n on n.oid=d.defaclnamespace
  where d.defaclrole='postgres'::regrole
    and n.nspname='public'
    and d.defaclobjtype='f';

  if coalesce(default_acl,'') like '%authenticated=X/%'
     or coalesce(default_acl,'') like '%anon=X/%'
     or coalesce(default_acl,'') like '%=X/%' then
    raise exception 'New public functions must not grant EXECUTE to authenticated, anon or PUBLIC by default: %', default_acl;
  end if;
end;
$$;
