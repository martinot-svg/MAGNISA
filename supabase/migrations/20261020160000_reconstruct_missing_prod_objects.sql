-- Reconstructed additive parity migration for MAGNISA test.
-- Recovered from live PostgreSQL catalog definitions; reviewed against test schema.
-- Safe to run on an already-partially-migrated schema. Do not apply to production
-- until the staged smoke tests and cross-tenant authorization checks pass.

begin;

-- 1. Document appearance snapshots (immutable final appearance captured at status transition).
create table if not exists public.document_appearance_snapshots (
  organization_id uuid not null references public.organizations(id),
  document_type text not null,
  document_id uuid not null,
  appearance jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (organization_id, document_type, document_id)
);
alter table public.document_appearance_snapshots enable row level security;
drop policy if exists document_appearance_read on public.document_appearance_snapshots;
create policy document_appearance_read
  on public.document_appearance_snapshots for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = document_appearance_snapshots.organization_id
      and m.user_id = auth.uid() and m.status = 'active'
  ));
revoke all on public.document_appearance_snapshots from public, anon, authenticated;
grant select on public.document_appearance_snapshots to authenticated;

-- 2. Document template lifecycle/version columns and append-only history.
alter table public.company_settings
  add column if not exists document_theme jsonb not null default '{}'::jsonb;
alter table public.document_templates
  add column if not exists lifecycle_status text not null default 'published',
  add column if not exists owner_user_id uuid references auth.users(id),
  add column if not exists version_number integer not null default 1,
  add column if not exists archived_at timestamptz;
do $migration$
begin
  if not exists (select 1 from pg_constraint where conname='document_templates_lifecycle_status_check' and conrelid='public.document_templates'::regclass) then
    alter table public.document_templates add constraint document_templates_lifecycle_status_check
      check (lifecycle_status in ('draft','in_review','published','archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname='document_templates_version_number_check' and conrelid='public.document_templates'::regclass) then
    alter table public.document_templates add constraint document_templates_version_number_check check (version_number >= 1);
  end if;
end
$migration$;

create table if not exists public.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete restrict,
  version_number integer not null check (version_number >= 1),
  configuration jsonb not null,
  name text not null,
  lifecycle_status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  unique (template_id, version_number)
);
alter table public.document_template_versions enable row level security;

-- 3. Restrictive per-user document permission overrides.
create table if not exists public.user_document_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null check (permission_key = any(array[
    'templates.view','templates.create','templates.edit_own','templates.edit_shared',
    'templates.publish','templates.archive','templates.delete','templates.set_default',
    'branding.view','branding.edit','branding.logo_manage','documents.preview',
    'documents.generate','documents.export','documents.print','documents.history.view',
    'permissions.manage'
  ])),
  allowed boolean not null default false check (allowed = false),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id,permission_key),
  foreign key (organization_id,user_id)
    references public.organization_members(organization_id,user_id) on delete cascade
);
alter table public.user_document_permissions enable row level security;
drop policy if exists user_document_permissions_read_self on public.user_document_permissions;
create policy user_document_permissions_read_self
  on public.user_document_permissions for select to authenticated
  using (auth.uid() = user_id and public.is_org_member(organization_id));
revoke all on public.user_document_permissions from public, anon, authenticated;
grant select on public.user_document_permissions to authenticated;
comment on table public.user_document_permissions is
  'Per-user restrictive overrides only. No elevated privileges are possible through this table.';

create or replace function public.can_view_document_template_version(p_org uuid, p_template uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $function$
declare role_name text; doc text; allowed boolean := false; role_deny boolean;
begin
  if auth.uid() is null then return false; end if;
  select m.role into role_name from public.organization_members m
   where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active';
  if role_name is null then return false; end if;
  select t.document_type into doc from public.document_templates t
   where t.id=p_template and t.organization_id=p_org;
  if doc is null then return false; end if;
  if role_name in ('owner','admin') then allowed := true;
  elsif role_name in ('finance_manager','accountant','director','auditor') and doc <> 'payslip' then allowed := true;
  elsif role_name='hr' and doc='payslip' then allowed := true;
  end if;
  if not allowed then return false; end if;
  select rp.allowed into role_deny from public.role_permissions rp
   where rp.organization_id=p_org and rp.role=role_name and rp.permission_key='documents.history.view';
  if role_deny is false then return false; end if;
  if exists (
    select 1 from public.user_document_permissions u
    where u.organization_id=p_org and u.user_id=auth.uid()
      and u.permission_key='documents.history.view' and u.allowed=false
  ) then return false; end if;
  return true;
end
$function$;
revoke all on function public.can_view_document_template_version(uuid,uuid) from public, anon;
grant execute on function public.can_view_document_template_version(uuid,uuid) to authenticated;

drop policy if exists document_template_versions_read on public.document_template_versions;
create policy document_template_versions_read on public.document_template_versions for select to authenticated
using (public.can_view_document_template_version(organization_id,template_id));
revoke all on public.document_template_versions from public, anon, authenticated;
grant select on public.document_template_versions to authenticated;

create or replace function public.capture_document_template_version()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare n integer;
begin
  if tg_op='UPDATE'
    and old.configuration is not distinct from new.configuration
    and old.lifecycle_status is not distinct from new.lifecycle_status
    and old.name is not distinct from new.name then return new; end if;
  if tg_op='UPDATE' then
    select coalesce(max(v.version_number),0)+1 into n
      from public.document_template_versions v where v.template_id=new.id;
    new.version_number := greatest(n,old.version_number+1);
  else
    new.version_number := 1;
  end if;
  return new;
end
$function$;

create or replace function public.store_document_template_version()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  insert into public.document_template_versions
    (organization_id,template_id,version_number,configuration,name,lifecycle_status,changed_by)
  values
    (new.organization_id,new.id,new.version_number,new.configuration,new.name,new.lifecycle_status,auth.uid())
  on conflict (template_id,version_number) do nothing;
  return new;
end
$function$;
drop trigger if exists document_template_version_before on public.document_templates;
create trigger document_template_version_before
  before insert or update on public.document_templates
  for each row execute function public.capture_document_template_version();
drop trigger if exists document_template_version_after on public.document_templates;
create trigger document_template_version_after
  after insert or update on public.document_templates
  for each row execute function public.store_document_template_version();
revoke all on function public.capture_document_template_version() from public, anon, authenticated;
revoke all on function public.store_document_template_version() from public, anon, authenticated;

-- 4. Payroll rule audit history.
create table if not exists public.payroll_rule_change_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  rule_id uuid not null,
  action text not null,
  actor_id uuid,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb
);
create index if not exists payroll_rule_change_log_org_date_idx
  on public.payroll_rule_change_log (organization_id, changed_at desc);
alter table public.payroll_rule_change_log enable row level security;
drop policy if exists payroll_rule_change_log_read on public.payroll_rule_change_log;
create policy payroll_rule_change_log_read on public.payroll_rule_change_log for select to authenticated
using (exists (
  select 1 from public.organization_members m
  where m.organization_id=payroll_rule_change_log.organization_id
    and m.user_id=auth.uid() and m.status='active'
));
revoke all on public.payroll_rule_change_log from public, anon, authenticated;
grant select on public.payroll_rule_change_log to authenticated;

create or replace function public.audit_payroll_rule_change()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if tg_op='INSERT' then
    insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,new_values)
    values(new.organization_id,new.id,'created',auth.uid(),to_jsonb(new));
    return new;
  elsif tg_op='UPDATE' then
    if old.status in ('validated','archived') and (
      old.cnaps_employee_rate is distinct from new.cnaps_employee_rate or
      old.cnaps_employer_rate is distinct from new.cnaps_employer_rate or
      old.health_employee_rate is distinct from new.health_employee_rate or
      old.health_employer_rate is distinct from new.health_employer_rate or
      old.fmfp_employer_rate is distinct from new.fmfp_employer_rate or
      old.cnaps_monthly_ceiling is distinct from new.cnaps_monthly_ceiling or
      old.health_monthly_ceiling is distinct from new.health_monthly_ceiling or
      old.irsa_brackets is distinct from new.irsa_brackets or
      old.irsa_minimum is distinct from new.irsa_minimum or
      old.rounding_policy is distinct from new.rounding_policy or
      old.effective_from is distinct from new.effective_from
    ) then raise exception 'Règle de paie validée immuable : créer une nouvelle version'; end if;
    insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values,new_values)
    values(new.organization_id,new.id,'updated',auth.uid(),to_jsonb(old),to_jsonb(new));
    return new;
  elsif tg_op='DELETE' then
    if old.status in ('validated','archived') then
      raise exception 'Suppression interdite pour une version validée ou archivée';
    end if;
    insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values)
    values(old.organization_id,old.id,'deleted',auth.uid(),to_jsonb(old));
    return old;
  end if;
  return null;
end
$function$;
drop trigger if exists payroll_rule_change_audit on public.payroll_rule_sets;
create trigger payroll_rule_change_audit before insert or update or delete on public.payroll_rule_sets
for each row execute function public.audit_payroll_rule_change();
revoke all on function public.audit_payroll_rule_change() from public, anon, authenticated;

-- 5. Draft payroll variables, restricted to the same tenant and editable run states.
create table if not exists public.payroll_variable_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  payroll_run_id uuid not null references public.payroll_runs(id),
  employee_id uuid not null references public.employees(id),
  bonuses numeric(20,2) not null default 0 check (bonuses >= 0),
  overtime numeric(20,2) not null default 0 check (overtime >= 0),
  other_earnings numeric(20,2) not null default 0 check (other_earnings >= 0),
  advances_recovered numeric(20,2) not null default 0 check (advances_recovered >= 0),
  other_deductions numeric(20,2) not null default 0 check (other_deductions >= 0),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (organization_id,payroll_run_id,employee_id)
);
alter table public.payroll_variable_drafts enable row level security;
drop policy if exists payroll_variable_drafts_select on public.payroll_variable_drafts;
create policy payroll_variable_drafts_select on public.payroll_variable_drafts for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));
drop policy if exists payroll_variable_drafts_insert on public.payroll_variable_drafts;
create policy payroll_variable_drafts_insert on public.payroll_variable_drafts for insert to authenticated
with check (
  public.has_org_permission(organization_id,'payroll.manage')
  and exists (select 1 from public.employees e
    where e.id=payroll_variable_drafts.employee_id
      and e.organization_id=payroll_variable_drafts.organization_id)
  and exists (select 1 from public.payroll_runs r
    where r.id=payroll_variable_drafts.payroll_run_id
      and r.organization_id=payroll_variable_drafts.organization_id
      and r.status in ('draft','calculated','review'))
);
drop policy if exists payroll_variable_drafts_update on public.payroll_variable_drafts;
create policy payroll_variable_drafts_update on public.payroll_variable_drafts for update to authenticated
using (public.has_org_permission(organization_id,'payroll.manage'))
with check (
  public.has_org_permission(organization_id,'payroll.manage')
  and exists (select 1 from public.employees e
    where e.id=payroll_variable_drafts.employee_id
      and e.organization_id=payroll_variable_drafts.organization_id)
  and exists (select 1 from public.payroll_runs r
    where r.id=payroll_variable_drafts.payroll_run_id
      and r.organization_id=payroll_variable_drafts.organization_id
      and r.status in ('draft','calculated','review'))
);
revoke all on public.payroll_variable_drafts from public, anon, authenticated;
grant select, insert, update on public.payroll_variable_drafts to authenticated;

-- 6. Employee IRSA dependants used by server-side payroll validation.
alter table public.employees add column if not exists irsa_dependants integer not null default 0;
do $migration$
begin
  if not exists (select 1 from pg_constraint where conname='employees_irsa_dependants_check' and conrelid='public.employees'::regclass) then
    alter table public.employees add constraint employees_irsa_dependants_check
      check (irsa_dependants >= 0 and irsa_dependants <= 30);
  end if;
end
$migration$;


-- Capture the exact company/template appearance when a payslip reaches a final payment state.
create or replace function public.capture_document_appearance()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare cfg jsonb; branding jsonb; typ text;
begin
  typ := tg_argv[0];
  if new.status <> all(string_to_array(tg_argv[1],',')) then return new; end if;
  if tg_op='UPDATE' and old.status=new.status then return new; end if;
  select to_jsonb(c) into branding from public.company_settings c where c.organization_id=new.organization_id;
  select dt.configuration into cfg from public.document_templates dt
    where dt.organization_id=new.organization_id and dt.document_type=typ and dt.is_default=true
    order by dt.updated_at desc limit 1;
  insert into public.document_appearance_snapshots(organization_id,document_type,document_id,appearance)
  values(new.organization_id,typ,new.id,jsonb_build_object('company',coalesce(branding,'{}'::jsonb),'template',coalesce(cfg,'{}'::jsonb)))
  on conflict do nothing;
  return new;
end
$function$;
drop trigger if exists capture_payslip_appearance on public.payslips;
create trigger capture_payslip_appearance
  after insert or update of status on public.payslips
  for each row execute function public.capture_document_appearance('payslip','validated,partially_paid,paid');
revoke all on function public.capture_document_appearance() from public, anon, authenticated;

commit;
