
grant execute on function public.has_org_permission(uuid,text) to authenticated;

-- Remove overly-broad member write policies from core commercial documents.
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
create policy customers_permission_insert on public.customers for insert to authenticated
  with check (public.has_org_permission(organization_id,'customers.create'));
create policy customers_permission_update on public.customers for update to authenticated
  using (public.has_org_permission(organization_id,'customers.create'))
  with check (public.has_org_permission(organization_id,'customers.create'));

drop policy if exists services_insert on public.services;
drop policy if exists services_update on public.services;
create policy services_permission_insert on public.services for insert to authenticated
  with check (public.has_org_permission(organization_id,'services.create'));
create policy services_permission_update on public.services for update to authenticated
  using (public.has_org_permission(organization_id,'services.create'))
  with check (public.has_org_permission(organization_id,'services.create'));

drop policy if exists prospects_insert on public.prospects;
drop policy if exists prospects_update on public.prospects;
create policy prospects_sales_insert on public.prospects for insert to authenticated
  with check (
    public.has_org_permission(organization_id,'customers.create')
    or public.has_org_permission(organization_id,'quotes.create')
  );
create policy prospects_sales_update on public.prospects for update to authenticated
  using (
    public.has_org_permission(organization_id,'customers.create')
    or public.has_org_permission(organization_id,'quotes.edit')
  )
  with check (
    public.has_org_permission(organization_id,'customers.create')
    or public.has_org_permission(organization_id,'quotes.edit')
  );

drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
create policy projects_sales_insert on public.projects for insert to authenticated
  with check (public.has_org_role(organization_id,array['owner','admin','director','sales']));
create policy projects_sales_update on public.projects for update to authenticated
  using (public.has_org_role(organization_id,array['owner','admin','director','sales']))
  with check (public.has_org_role(organization_id,array['owner','admin','director','sales']));

-- These financial/commercial documents must be mutated through guarded RPCs, not raw table writes.
drop policy if exists quotes_insert on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quote_lines_insert on public.quote_lines;
drop policy if exists quote_lines_update on public.quote_lines;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists order_lines_insert on public.order_lines;
drop policy if exists order_lines_update on public.order_lines;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoice_lines_insert on public.invoice_lines;
drop policy if exists invoice_lines_update on public.invoice_lines;
drop policy if exists credit_notes_insert on public.credit_notes;
drop policy if exists credit_notes_update on public.credit_notes;

-- Audit is append-only through trusted database code. Users can only read it with audit permission.
drop policy if exists audit_logs_insert on public.audit_logs;
drop policy if exists audit_logs_update on public.audit_logs;
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_authorized_select on public.audit_logs for select to authenticated
  using (public.has_org_permission(organization_id,'audit.view'));

-- Sensitive ancillary finance tables: no generic member writes.
drop policy if exists cheques_insert on public.cheques;
drop policy if exists cheques_update on public.cheques;
create policy cheques_finance_insert on public.cheques for insert to authenticated
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant','cashier']));
create policy cheques_finance_update on public.cheques for update to authenticated
  using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant','cashier']))
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant','cashier']));

drop policy if exists fixed_assets_insert on public.fixed_assets;
drop policy if exists fixed_assets_update on public.fixed_assets;
create policy fixed_assets_finance_insert on public.fixed_assets for insert to authenticated
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));
create policy fixed_assets_finance_update on public.fixed_assets for update to authenticated
  using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists partner_accounts_insert on public.partner_accounts;
drop policy if exists partner_accounts_update on public.partner_accounts;
create policy partner_accounts_finance_insert on public.partner_accounts for insert to authenticated
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));
create policy partner_accounts_finance_update on public.partner_accounts for update to authenticated
  using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));

drop policy if exists analysis_actions_insert on public.analysis_actions;
drop policy if exists analysis_actions_update on public.analysis_actions;
create policy analysis_actions_management_insert on public.analysis_actions for insert to authenticated
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));
create policy analysis_actions_management_update on public.analysis_actions for update to authenticated
  using (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']))
  with check (public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));
