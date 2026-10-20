create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.organization_member_directory(p_org uuid)
returns table(user_id uuid,email text,role text,status text,created_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'users.manage');
  return query
  select om.user_id,coalesce(p.email,u.email),om.role,om.status,om.created_at
  from public.organization_members om
  join auth.users u on u.id=om.user_id
  left join public.profiles p on p.id=om.user_id
  where om.organization_id=p_org
  order by om.created_at;
end;
$$;
revoke execute on function public.organization_member_directory(uuid) from public,anon;
grant execute on function public.organization_member_directory(uuid) to authenticated,service_role;
