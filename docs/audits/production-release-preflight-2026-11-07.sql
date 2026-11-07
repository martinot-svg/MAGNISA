-- MAGNISA production release preflight (read-only).
-- Run against the production database before applying the coordinated payroll release.
-- This script intentionally contains SELECT statements only.

-- 1) Required schema objects for the candidate application.
select
  to_regprocedure('public.archive_payroll_rule(uuid,uuid)') is not null as archive_payroll_rule_ready,
  to_regprocedure('public.delete_payroll_rule_draft(uuid,uuid,text)') is not null as delete_payroll_rule_draft_ready,
  position('v_deductible_health' in pg_get_functiondef('public.payroll_compute_fmfp_on_insert()'::regprocedure)) > 0
    and position('0.02' in pg_get_functiondef('public.payroll_compute_fmfp_on_insert()'::regprocedure)) > 0
    as irsa_health_deduction_cap_ready,
  position('existing.effective_from = v.effective_from' in pg_get_functiondef('public.activate_payroll_rule(uuid,uuid)'::regprocedure)) > 0
    as duplicate_payroll_rule_start_guard_ready,
  to_regprocedure('public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)') is not null as create_payslip_with_supplementary_pension_ready,
  to_regprocedure('public.payroll_compute_fmfp_on_insert()') is not null as payroll_validation_trigger_function_present,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payslips'
      and column_name='taxable_supplementary_pension'
  ) as payslips_supplementary_pension_column_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payroll_variable_drafts'
      and column_name='taxable_supplementary_pension'
  ) as drafts_supplementary_pension_column_ready,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='organization_members'
      and policyname='member_select'
  ) as organization_member_self_read_policy_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='recurring_service_contracts'
      and column_name='billing_timing'
  ) as recurring_billing_timing_column_ready,
  to_regprocedure('public.create_recurring_service_contract(uuid,uuid,uuid,text,date,date,integer,text)') is not null
    as recurring_billing_timing_rpc_ready,
  to_regclass('public.accounting_fiscal_years') is not null as accounting_fiscal_years_table_ready,
  to_regprocedure('public.magnisa_create_fiscal_year(uuid,date,date,text,jsonb)') is not null
    as fiscal_year_create_rpc_ready,
  to_regprocedure('public.magnisa_close_fiscal_year(uuid,uuid)') is not null
    as fiscal_year_close_rpc_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='lot1_financial_idempotency'
      and column_name='updated_at'
  ) as financial_idempotency_updated_at_ready;

-- 2) Payroll-rule date integrity. Both counts should be zero.
with duplicate_starts as (
  select organization_id,effective_from
  from public.payroll_rule_sets
  where status='validated'
  group by organization_id,effective_from
  having count(*) > 1
),
overlap_pairs as (
  select a.id
  from public.payroll_rule_sets a
  join public.payroll_rule_sets b
    on b.organization_id=a.organization_id and b.id>a.id
  where a.status='validated' and b.status='validated'
    and daterange(a.effective_from,coalesce(a.effective_to,'infinity'::date),'[]')
        && daterange(b.effective_from,coalesce(b.effective_to,'infinity'::date),'[]')
)
select
  (select count(*) from duplicate_starts) as duplicate_validated_start_groups,
  (select count(*) from overlap_pairs) as overlapping_validated_period_pairs,
  (select count(*) from public.payroll_rule_sets where status='validated') as validated_rule_sets,
  (select count(*) from public.payroll_rule_sets where status in ('draft','pending_review')) as unvalidated_rule_sets;

-- 3) Anonymous table privileges. After the hardening migration, both counts should be zero.
select
  count(*) filter (
    where has_table_privilege('anon',c.oid,'select')
       or has_table_privilege('anon',c.oid,'insert')
       or has_table_privilege('anon',c.oid,'update')
       or has_table_privilege('anon',c.oid,'delete')
  ) as tables_with_anon_dml_or_read,
  count(*) filter (
    where (has_table_privilege('anon',c.oid,'select')
        or has_table_privilege('anon',c.oid,'insert')
        or has_table_privilege('anon',c.oid,'update')
        or has_table_privilege('anon',c.oid,'delete'))
      and not c.relrowsecurity
  ) as anon_privileged_tables_without_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r';

-- 4) RLS-enabled tables without policies must not be directly accessible to API roles.
select
  c.relname as table_name,
  has_table_privilege('anon',c.oid,'select') as anon_select,
  has_table_privilege('authenticated',c.oid,'select') as authenticated_select
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind='r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname='public' and p.tablename=c.relname
  )
order by c.relname;

-- 5) SECURITY DEFINER RPC exposure. Anonymous execution should remain zero.
select
  count(*) as total_security_definer_functions,
  count(*) filter (
    where has_function_privilege('anon',p.oid,'execute')
  ) as anon_executable_security_definer_functions,
  count(*) filter (
    where has_function_privilege('authenticated',p.oid,'execute')
  ) as authenticated_executable_security_definer_functions
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef;

-- 6) Private legal archive: service_role only, with RLS enabled.
select
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon',c.oid,'select') as anon_select,
  has_table_privilege('authenticated',c.oid,'select') as authenticated_select,
  has_table_privilege('service_role',c.oid,'select') as service_role_select
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='payroll_legal_documents' and c.relkind='r';
