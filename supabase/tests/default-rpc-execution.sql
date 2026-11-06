do $$
begin
  if has_function_privilege('authenticated', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by anon';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole
      and n.nspname='public'
      and d.defaclobjtype='f'
      and a.privilege_type='EXECUTE'
      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'New public functions must not grant EXECUTE to authenticated, anon or PUBLIC by default';
  end if;
end;
$$;
