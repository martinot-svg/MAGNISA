-- Verify anon has no direct access to current public tables/sequences and
-- that objects created by postgres do not receive anon grants by default.
begin;

create table public.__magnisa_anon_acl_test (id bigint);
create sequence public.__magnisa_anon_acl_test_seq;

do $$
begin
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee = 'anon'
  ) then
    raise exception 'TEST FAILED: anon still has explicit privileges on public tables';
  end if;

  if exists (
    select 1
      from information_schema.role_usage_grants
     where object_schema = 'public'
       and object_type = 'SEQUENCE'
       and grantee = 'anon'
  ) then
    raise exception 'TEST FAILED: anon still has explicit privileges on public sequences';
  end if;

  if has_table_privilege('anon', 'public.__magnisa_anon_acl_test', 'SELECT')
     or has_table_privilege('anon', 'public.__magnisa_anon_acl_test', 'INSERT')
     or has_sequence_privilege('anon', 'public.__magnisa_anon_acl_test_seq', 'USAGE') then
    raise exception 'TEST FAILED: postgres default privileges still expose new objects to anon';
  end if;

  if exists (
    select 1
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole
       and n.nspname = 'public'
       and d.defaclobjtype in ('r', 'S')
       and a.grantee = 'anon'::regrole
  ) then
    raise exception 'TEST FAILED: postgres default ACL still grants public objects to anon';
  end if;
end;
$$;

drop table public.__magnisa_anon_acl_test;
drop sequence public.__magnisa_anon_acl_test_seq;

commit;
