drop policy if exists commission_policies_insert on public.commission_policies;
drop policy if exists commission_policies_update on public.commission_policies;
drop policy if exists commission_policy_rules_insert on public.commission_policy_rules;
drop policy if exists commission_policy_rules_update on public.commission_policy_rules;
drop policy if exists commission_policy_rules_delete on public.commission_policy_rules;
drop policy if exists prospect_contributors_insert on public.prospect_contributors;
drop policy if exists commission_calculations_insert on public.commission_calculations;
drop policy if exists commission_calculations_update on public.commission_calculations;
drop policy if exists commission_allocations_insert on public.commission_allocations;
drop policy if exists commission_payments_insert on public.commission_payments;

revoke insert, update, delete, truncate on public.commission_policies from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_policy_rules from public, anon, authenticated;
revoke insert, update, delete, truncate on public.prospect_contributors from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_calculations from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_allocations from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_payments from public, anon, authenticated;