create table if not exists public.payroll_variable_drafts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 payroll_run_id uuid not null references public.payroll_runs(id),
 employee_id uuid not null references public.employees(id),
 bonuses numeric(20,2) not null default 0 check(bonuses>=0),
 overtime numeric(20,2) not null default 0 check(overtime>=0),
 other_earnings numeric(20,2) not null default 0 check(other_earnings>=0),
 advances_recovered numeric(20,2) not null default 0 check(advances_recovered>=0),
 other_deductions numeric(20,2) not null default 0 check(other_deductions>=0),
 created_by uuid default auth.uid(),
 updated_at timestamptz not null default now(),
 unique(organization_id,payroll_run_id,employee_id)
);
alter table public.payroll_variable_drafts enable row level security;
create policy payroll_variable_drafts_select on public.payroll_variable_drafts for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));
create policy payroll_variable_drafts_insert on public.payroll_variable_drafts for insert to authenticated
with check (public.has_org_permission(organization_id,'payroll.manage')
and exists(select 1 from public.employees e where e.id=employee_id and e.organization_id=organization_id)
and exists(select 1 from public.payroll_runs r where r.id=payroll_run_id and r.organization_id=organization_id and r.status in ('draft','calculated','review')));
create policy payroll_variable_drafts_update on public.payroll_variable_drafts for update to authenticated
using (public.has_org_permission(organization_id,'payroll.manage'))
with check (public.has_org_permission(organization_id,'payroll.manage')
and exists(select 1 from public.employees e where e.id=employee_id and e.organization_id=organization_id)
and exists(select 1 from public.payroll_runs r where r.id=payroll_run_id and r.organization_id=organization_id and r.status in ('draft','calculated','review')));
grant select,insert,update on public.payroll_variable_drafts to authenticated;