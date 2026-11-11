create or replace function public.has_org_role(p_org uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members m
    where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active' and m.role=any(p_roles)
  );
$$;

do $$
declare t text;
begin
  foreach t in array array['company_settings','number_sequences','organization_features','role_permissions','document_templates'] loop
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('create policy %I_admin_insert on public.%I for insert with check(public.has_org_role(organization_id,array[''owner'',''admin'']))',t,t);
    execute format('create policy %I_admin_update on public.%I for update using(public.has_org_role(organization_id,array[''owner'',''admin''])) with check(public.has_org_role(organization_id,array[''owner'',''admin'']))',t,t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['financial_accounts','payments','expenses','financial_transactions','journal_entries','journal_entry_lines','tax_obligations','social_obligations','budgets','supplier_invoices','supplier_payments','loans','partner_account_movements'] loop
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('create policy %I_finance_insert on public.%I for insert with check(public.has_org_role(organization_id,array[''owner'',''admin'',''director'',''finance_manager'',''accountant'',''cashier'']))',t,t);
    execute format('create policy %I_finance_update on public.%I for update using(public.has_org_role(organization_id,array[''owner'',''admin'',''director'',''finance_manager'',''accountant'',''cashier''])) with check(public.has_org_role(organization_id,array[''owner'',''admin'',''director'',''finance_manager'',''accountant'',''cashier'']))',t,t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees','payroll_runs','payslips','salary_advances','payroll_payments'] loop
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('create policy %I_payroll_insert on public.%I for insert with check(public.has_org_role(organization_id,array[''owner'',''admin'',''hr'',''finance_manager'',''accountant'']))',t,t);
    execute format('create policy %I_payroll_update on public.%I for update using(public.has_org_role(organization_id,array[''owner'',''admin'',''hr'',''finance_manager'',''accountant''])) with check(public.has_org_role(organization_id,array[''owner'',''admin'',''hr'',''finance_manager'',''accountant'']))',t,t);
  end loop;
end $$;

drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_procurement_insert on public.suppliers for insert with check(public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));
create policy suppliers_procurement_update on public.suppliers for update using(public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant'])) with check(public.has_org_role(organization_id,array['owner','admin','director','finance_manager','accountant']));