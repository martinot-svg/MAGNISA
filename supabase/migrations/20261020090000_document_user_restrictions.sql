-- MAGNISA documentary rights: staging migration, NOT applied to production.
create table if not exists public.user_document_permissions (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 permission_key text not null check (permission_key = any(array['templates.view','templates.create','templates.edit_own','templates.edit_shared','templates.publish','templates.archive','templates.delete','templates.set_default','branding.view','branding.edit','branding.logo_manage','documents.preview','documents.generate','documents.export','documents.print','documents.history.view','permissions.manage'])),
 allowed boolean not null default false check (allowed = false),
 granted_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(organization_id,user_id,permission_key),
 foreign key (organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
alter table public.user_document_permissions enable row level security;
create policy user_document_permissions_read_self on public.user_document_permissions for select to authenticated using (
 auth.uid() = user_id and public.is_org_member(organization_id)
);
-- No client INSERT / UPDATE / DELETE policies. Only controlled server-side migration/service role process may assign additional *denials*.
comment on table public.user_document_permissions is 'Per-user restrictive overrides only. No elevated privileges are possible through this table.';
