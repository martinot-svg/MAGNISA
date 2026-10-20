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
 template_id uuid not null references public.document_templates(id) on delete cascade,
 version_number integer not null check(version_number>=1),
 configuration jsonb not null,
 name text not null,
 lifecycle_status text not null,
 changed_by uuid,
 changed_at timestamptz not null default now(),
 unique(template_id,version_number)
);
alter table public.document_template_versions enable row level security;
create policy document_template_versions_read on public.document_template_versions for select to authenticated using(public.is_org_member(organization_id));
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