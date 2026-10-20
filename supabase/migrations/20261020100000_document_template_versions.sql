-- Additive version history for the existing document_templates table.
alter table public.document_templates
 add column if not exists lifecycle_status text not null default 'published'
 check (lifecycle_status in ('draft','in_review','published','archived')),
 add column if not exists owner_user_id uuid references auth.users(id),
 add column if not exists version_number integer not null default 1 check (version_number>=1),
 add column if not exists archived_at timestamptz;
create table if not exists public.document_template_versions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 template_id uuid not null references public.document_templates(id) on delete restrict,
 version_number integer not null check(version_number>=1),
 configuration jsonb not null,
 name text not null,
 lifecycle_status text not null,
 changed_by uuid,
 changed_at timestamptz not null default now(),
 unique(template_id,version_number)
);
alter table public.document_template_versions enable row level security;
-- Enforce both tenant isolation and within-tenant document role permissions.
create or replace function public.can_view_document_template_version(p_org uuid,p_template uuid)
returns boolean language plpgsql stable security definer set search_path=public as $
declare role_name text; doc text; allowed boolean:=false; role_deny boolean;
begin
 if auth.uid() is null then return false;end if;
 select m.role into role_name from public.organization_members m
 where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active';
 if role_name is null then return false;end if;
 select t.document_type into doc from public.document_templates t where t.id=p_template and t.organization_id=p_org;
 if doc is null then return false;end if;
 if role_name in ('owner','admin') then allowed:=true;
 elsif role_name in ('finance_manager','accountant','director','auditor') and doc<>'payslip' then allowed:=true;
 elsif role_name='hr' and doc='payslip' then allowed:=true;
 end if;
 if not allowed then return false;end if;
 select rp.allowed into role_deny from public.role_permissions rp where rp.organization_id=p_org and rp.role=role_name and rp.permission_key='documents.history.view';
 if role_deny is false then return false;end if;
 if exists(select 1 from public.user_document_permissions u where u.organization_id=p_org and u.user_id=auth.uid() and u.permission_key='documents.history.view' and u.allowed=false) then return false;end if;
 return true;
end $;
revoke all on function public.can_view_document_template_version(uuid,uuid) from public;
grant execute on function public.can_view_document_template_version(uuid,uuid) to authenticated;
create policy document_template_versions_read on public.document_template_versions for select to authenticated
using(public.can_view_document_template_version(organization_id,template_id));
-- Direct client writes to history are forbidden; only the definer trigger inserts versions.
create or replace function public.capture_document_template_version()
returns trigger language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if tg_op='UPDATE' and old.configuration is not distinct from new.configuration and old.lifecycle_status is not distinct from new.lifecycle_status and old.name is not distinct from new.name then return new; end if;
 if tg_op='UPDATE' then
  select coalesce(max(v.version_number),0)+1 into n from public.document_template_versions v where v.template_id=new.id;
  new.version_number:=greatest(n,old.version_number+1);
 else
  new.version_number:=1;
 end if;
 return new;
end $$;
create trigger document_template_version_before before insert or update on public.document_templates for each row execute function public.capture_document_template_version();
create or replace function public.store_document_template_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.document_template_versions(organization_id,template_id,version_number,configuration,name,lifecycle_status,changed_by)
 values(new.organization_id,new.id,new.version_number,new.configuration,new.name,new.lifecycle_status,auth.uid())
 on conflict(template_id,version_number) do nothing;
 return new;
end $$;
create trigger document_template_version_after after insert or update on public.document_templates for each row execute function public.store_document_template_version();