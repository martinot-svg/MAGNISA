alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
check(role in ('owner','admin','director','finance_manager','accountant','sales','cashier','hr','auditor','employee','viewer'));

create table if not exists public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  permission_key text not null,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key(organization_id,role,permission_key)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_select on public.role_permissions for select using(public.is_org_member(organization_id));
create policy role_permissions_insert on public.role_permissions for insert with check(public.is_org_member(organization_id));
create policy role_permissions_update on public.role_permissions for update using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id));