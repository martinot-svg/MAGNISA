
-- SECURITY HARDENING: functions are not public APIs for anonymous callers.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- Internal-only helpers/triggers must not be callable directly by signed-in clients.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'audit_event',
        'next_document_number',
        'initialize_organization_features',
        'sync_auth_profile',
        'rls_auto_enable'
      )
  loop
    execute format('revoke execute on function %s from authenticated', r.signature);
  end loop;
end $$;

-- Keep the membership predicates available to authenticated RLS/RPC execution.
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;
grant execute on function public.assert_org_access(uuid) to authenticated;
