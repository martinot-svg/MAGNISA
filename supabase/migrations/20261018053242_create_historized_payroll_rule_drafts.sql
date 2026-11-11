create table if not exists public.payroll_rule_sets (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 effective_from date not null,
 effective_to date,
 status text not null default 'draft' check(status in ('draft','pending_review','validated','archived')),
 cnaps_employee_rate numeric(8,6) not null default 0,
 cnaps_employer_rate numeric(8,6) not null default 0,
 health_employee_rate numeric(8,6) not null default 0,
 health_employer_rate numeric(8,6) not null default 0,
 fmfp_employer_rate numeric(8,6) not null default 0,
 cnaps_monthly_ceiling numeric(18,2),
 health_monthly_ceiling numeric(18,2),
 irsa_brackets jsonb not null default '[]'::jsonb,
 irsa_minimum numeric(18,2) not null default 0,
 rounding_policy text not null default 'unverified',
 legal_reference text,
 reviewed_by uuid,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint payroll_rule_date_check check(effective_to is null or effective_to>=effective_from),
 constraint payroll_rule_rates_check check(cnaps_employee_rate between 0 and 1 and cnaps_employer_rate between 0 and 1 and health_employee_rate between 0 and 1 and health_employer_rate between 0 and 1 and fmfp_employer_rate between 0 and 1),
 constraint payroll_rule_ceiling_check check((cnaps_monthly_ceiling is null or cnaps_monthly_ceiling>=0) and (health_monthly_ceiling is null or health_monthly_ceiling>=0))
);
create index if not exists payroll_rules_org_dates_idx on public.payroll_rule_sets(organization_id,effective_from desc);
alter table public.payroll_rule_sets enable row level security;
create policy payroll_rule_read on public.payroll_rule_sets for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=payroll_rule_sets.organization_id and m.user_id=auth.uid() and m.status='active'));
create policy payroll_rule_insert on public.payroll_rule_sets for insert to authenticated with check(public.has_org_permission(organization_id,'payroll.manage') and status in ('draft','pending_review'));
create policy payroll_rule_update on public.payroll_rule_sets for update to authenticated using(public.has_org_permission(organization_id,'payroll.manage') and status in ('draft','pending_review')) with check(public.has_org_permission(organization_id,'payroll.manage') and status in ('draft','pending_review'));
comment on table public.payroll_rule_sets is 'Historized Malagasy payroll parameters; unverified sets must never be used for regulatory autopay.';
