-- MAGNISA 0014
-- Remove cashier from configuration/accounting writes that are not cashier duties.

drop policy if exists budgets_finance_insert on public.budgets;
create policy budgets_finance_insert on public.budgets
for insert with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists budgets_finance_update on public.budgets;
create policy budgets_finance_update on public.budgets
for update
using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists financial_accounts_finance_insert on public.financial_accounts;
create policy financial_accounts_finance_insert on public.financial_accounts
for insert with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists financial_accounts_finance_update on public.financial_accounts;
create policy financial_accounts_finance_update on public.financial_accounts
for update
using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists loans_finance_insert on public.loans;
create policy loans_finance_insert on public.loans
for insert with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists loans_finance_update on public.loans;
create policy loans_finance_update on public.loans
for update
using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists partner_account_movements_finance_insert on public.partner_account_movements;
create policy partner_account_movements_finance_insert on public.partner_account_movements
for insert with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists partner_account_movements_finance_update on public.partner_account_movements;
create policy partner_account_movements_finance_update on public.partner_account_movements
for update
using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists tax_obligations_finance_insert on public.tax_obligations;
create policy tax_obligations_finance_insert on public.tax_obligations
for insert with check (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']));

drop policy if exists tax_obligations_finance_update on public.tax_obligations;
create policy tax_obligations_finance_update on public.tax_obligations
for update
using (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']));

drop policy if exists social_obligations_finance_insert on public.social_obligations;
create policy social_obligations_finance_insert on public.social_obligations
for insert with check (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']));

drop policy if exists social_obligations_finance_update on public.social_obligations;
create policy social_obligations_finance_update on public.social_obligations
for update
using (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']))
with check (public.has_org_role(organization_id,array['owner','admin','finance_manager','accountant']));
