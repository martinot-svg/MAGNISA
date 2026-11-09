-- Keep organization members visible to authorized collaborators even when
-- a profile synchronization row is temporarily absent.
create or replace function public.list_collaboration_members(p_org uuid)
returns table(user_id uuid, role text, department text, status text, email text)
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'sales.view')
    or public.has_org_permission(p_org,'commissions.contribute')
    or public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'Accès au répertoire commercial refusé.';
  end if;
  return query
  select m.user_id,m.role,m.department,m.status,p.email
  from public.organization_members m
  left join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org
  order by (m.status='active') desc, coalesce(p.email,m.user_id::text);
end;
$function$;
revoke all on function public.list_collaboration_members(uuid) from public, anon;
grant execute on function public.list_collaboration_members(uuid) to authenticated;