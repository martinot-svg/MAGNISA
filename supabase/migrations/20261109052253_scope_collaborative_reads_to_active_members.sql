-- Keep all collaboration and commission self-read paths scoped to current
-- active organization membership. The previous self-owner OR branches allowed
-- a removed member to read their former organization's historical rows.
drop policy if exists prospect_interventions_select on public.prospect_interventions;
create policy prospect_interventions_select
  on public.prospect_interventions for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      public.has_org_permission(organization_id, 'sales.view')
      or public.has_org_permission(organization_id, 'commissions.contribute')
      or public.has_org_permission(organization_id, 'commissions.policy.manage')
      or public.has_org_permission(organization_id, 'commissions.audit')
      or contributor_user_id = (select auth.uid())
      or created_by = (select auth.uid())
    )
  );
drop policy if exists prospect_intervention_history_select on public.prospect_intervention_history;
create policy prospect_intervention_history_select
  on public.prospect_intervention_history for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      public.has_org_permission(organization_id, 'sales.view')
      or public.has_org_permission(organization_id, 'commissions.policy.manage')
      or public.has_org_permission(organization_id, 'commissions.audit')
      or actor_user_id = (select auth.uid())
    )
  );
drop policy if exists prospect_contributors_select on public.prospect_contributors;
create policy prospect_contributors_select
  on public.prospect_contributors for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      user_id = (select auth.uid())
      or public.has_org_permission(organization_id, 'commissions.view_team')
      or public.has_org_permission(organization_id, 'commissions.audit')
    )
  );
drop policy if exists commission_allocations_select on public.commission_allocations;
create policy commission_allocations_select
  on public.commission_allocations for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      user_id = (select auth.uid())
      or public.has_org_permission(organization_id, 'commissions.view_team')
      or public.has_org_permission(organization_id, 'commissions.audit')
    )
  );
drop policy if exists commission_calculations_select on public.commission_calculations;
create policy commission_calculations_select
  on public.commission_calculations for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      public.has_org_permission(organization_id, 'commissions.view_team')
      or public.has_org_permission(organization_id, 'commissions.audit')
      or exists (
        select 1 from public.commission_allocations a
        where a.calculation_id = commission_calculations.id
          and a.organization_id = commission_calculations.organization_id
          and a.user_id = (select auth.uid())
      )
    )
  );
drop policy if exists commission_payments_select on public.commission_payments;
create policy commission_payments_select
  on public.commission_payments for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      public.has_org_permission(organization_id, 'commissions.view_team')
      or public.has_org_permission(organization_id, 'commissions.audit')
      or exists (
        select 1 from public.commission_allocations a
        where a.id = commission_payments.allocation_id
          and a.organization_id = commission_payments.organization_id
          and a.user_id = (select auth.uid())
      )
    )
  );
drop policy if exists commission_policies_select on public.commission_policies;
create policy commission_policies_select
  on public.commission_policies for select to authenticated
  using (
    (select public.is_org_member(organization_id))
    and (
      public.has_org_permission(organization_id, 'commissions.policy.manage')
      or public.has_org_permission(organization_id, 'commissions.calculate')
      or public.has_org_permission(organization_id, 'commissions.view_own')
    )
  );