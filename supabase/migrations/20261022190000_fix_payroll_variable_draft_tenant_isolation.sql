-- Fix cross-organization references in payroll variable draft RLS policies.
-- The prior predicates compared each joined row's organization_id to itself,
-- which did not bind the employee/payroll run to the draft's organization.
begin;

alter policy payroll_variable_drafts_insert
  on public.payroll_variable_drafts
  with check (
    public.has_org_permission(organization_id, 'payroll.manage')
    and exists (
      select 1
      from public.employees e
      where e.id = payroll_variable_drafts.employee_id
        and e.organization_id = payroll_variable_drafts.organization_id
    )
    and exists (
      select 1
      from public.payroll_runs r
      where r.id = payroll_variable_drafts.payroll_run_id
        and r.organization_id = payroll_variable_drafts.organization_id
        and r.status in ('draft', 'calculated', 'review')
    )
  );

alter policy payroll_variable_drafts_update
  on public.payroll_variable_drafts
  using (
    public.has_org_permission(organization_id, 'payroll.manage')
    and exists (
      select 1
      from public.employees e
      where e.id = payroll_variable_drafts.employee_id
        and e.organization_id = payroll_variable_drafts.organization_id
    )
    and exists (
      select 1
      from public.payroll_runs r
      where r.id = payroll_variable_drafts.payroll_run_id
        and r.organization_id = payroll_variable_drafts.organization_id
        and r.status in ('draft', 'calculated', 'review')
    )
  )
  with check (
    public.has_org_permission(organization_id, 'payroll.manage')
    and exists (
      select 1
      from public.employees e
      where e.id = payroll_variable_drafts.employee_id
        and e.organization_id = payroll_variable_drafts.organization_id
    )
    and exists (
      select 1
      from public.payroll_runs r
      where r.id = payroll_variable_drafts.payroll_run_id
        and r.organization_id = payroll_variable_drafts.organization_id
        and r.status in ('draft', 'calculated', 'review')
    )
  );

commit;
