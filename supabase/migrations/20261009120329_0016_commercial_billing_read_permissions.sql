
-- MAGNISA 0016: separate commercial and billing read privileges.

create or replace function public.has_org_permission(p_org uuid, p_permission text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_override boolean;
begin
  if auth.uid() is null then return false; end if;

  select role into v_role
  from public.organization_members
  where organization_id=p_org and user_id=auth.uid() and status='active'
  limit 1;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select allowed into v_override
  from public.role_permissions
  where organization_id=p_org and role=v_role and permission_key=p_permission
  limit 1;
  if found then return coalesce(v_override,false); end if;

  return case v_role
    when 'admin' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','invoices.cancel','payments.record',
      'expenses.record','treasury.transfer','suppliers.manage','payroll.manage','payroll.pay',
      'accounting.manage','reports.export','settings.manage','users.manage','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view',
      'sales.view','billing.view'
    ])
    when 'director' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','payments.record','expenses.record',
      'treasury.transfer','suppliers.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','suppliers.view','reports.view',
      'sales.view','billing.view'
    ])
    when 'finance_manager' then p_permission = any(array[
      'invoices.issue','invoices.cancel','payments.record','expenses.record','treasury.transfer',
      'suppliers.manage','payroll.pay','accounting.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view',
      'billing.view'
    ])
    when 'accountant' then p_permission = any(array[
      'invoices.issue','payments.record','expenses.record','suppliers.manage','payroll.manage',
      'accounting.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view',
      'billing.view'
    ])
    when 'sales' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','sales.view','billing.view'
    ])
    when 'cashier' then p_permission = any(array[
      'payments.record','expenses.record','treasury.view','billing.view'
    ])
    when 'hr' then p_permission = any(array['payroll.manage','payroll.view'])
    when 'auditor' then p_permission = any(array[
      'reports.export','audit.view','accounting.view','reports.view','billing.view'
    ])
    else false
  end;
end
$$;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
for select to authenticated
using (public.has_org_permission(organization_id,'billing.view'));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
for select to authenticated
using (public.has_org_permission(organization_id,'billing.view'));

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
for select to authenticated
using (public.has_org_permission(organization_id,'billing.view'));

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes
for select to authenticated
using (public.has_org_permission(organization_id,'billing.view'));

drop policy if exists prospects_select on public.prospects;
create policy prospects_select on public.prospects
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

drop policy if exists services_select on public.services;
create policy services_select on public.services
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'billing.view')
);

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

drop policy if exists quote_lines_select on public.quote_lines;
create policy quote_lines_select on public.quote_lines
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

drop policy if exists order_lines_select on public.order_lines;
create policy order_lines_select on public.order_lines
for select to authenticated
using (public.has_org_permission(organization_id,'sales.view'));

-- Analytical RPCs must not bypass the role model.
create or replace function public.analysis_metrics(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.budgets%rowtype;
  v_start date;
  v_end date;
begin
  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org,'finance.view') then
    raise exception 'Action non autorisée pour ce rôle';
  end if;

  v_start:=date_trunc('month',current_date)::date;
  v_end:=(date_trunc('month',current_date)+interval '1 month - 1 day')::date;

  select * into v_budget
  from public.budgets
  where organization_id=p_org and period_start<=current_date and period_end>=current_date and scenario='normal'
  order by period_start desc limit 1;

  return jsonb_build_object(
    'revenue',coalesce((select sum(subtotal) from public.invoices where organization_id=p_org and status not in ('draft','cancelled') and issue_date between v_start and v_end),0),
    'budget_revenue',v_budget.revenue_budget,
    'expenses',coalesce((select sum(amount) from public.expenses where organization_id=p_org and status in ('validated','paid') and expense_date between v_start and v_end),0),
    'budget_expenses',v_budget.expense_budget,
    'receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and status not in ('draft','cancelled','paid')),0),
    'overdue_receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date<current_date and status<>'cancelled'),0),
    'cash_available',coalesce((select sum(balance) from public.financial_accounts where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')),0),
    'expected_receipts_30d',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date between current_date and current_date+30 and status<>'cancelled'),0),
    'obligations_30d',
      coalesce((select sum(amount-paid_amount) from public.tax_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=current_date+30),0)
      +coalesce((select sum(amount-paid_amount) from public.social_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=current_date+30),0),
    'unbilled_completed_services',0
  );
end;
$$;

create or replace function public.management_financial_statements(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assets numeric;
  v_liabilities numeric;
  v_revenue numeric;
  v_expenses numeric;
begin
  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org,'accounting.view') then
    raise exception 'Action non autorisée pour ce rôle';
  end if;

  select coalesce(sum(debit-credit),0) into v_assets
  from public.journal_entry_lines
  where organization_id=p_org
    and (account_key='AR' or account_key like 'TREASURY:%' or account_key='EMPLOYEE_ADVANCE_RECEIVABLE');

  select coalesce(sum(credit-debit),0) into v_liabilities
  from public.journal_entry_lines
  where organization_id=p_org
    and (
      account_key='AP'
      or account_key='PAYROLL_PAYABLE'
      or account_key like 'TAX_PAYABLE%'
      or account_key='SOCIAL_PAYABLE'
      or account_key='HEALTH_PAYABLE'
      or account_key='OTHER_PAYROLL_PAYABLE'
    );

  select coalesce(sum(credit-debit),0) into v_revenue
  from public.journal_entry_lines
  where organization_id=p_org and account_key='SALES_REVENUE';

  select coalesce(sum(debit-credit),0) into v_expenses
  from public.journal_entry_lines
  where organization_id=p_org
    and (account_key like 'EXPENSE:%' or account_key like 'PAYROLL_EXPENSE:%');

  return jsonb_build_object(
    'assets',v_assets,
    'liabilities',v_liabilities,
    'equity',v_assets-v_liabilities,
    'revenue',v_revenue,
    'expenses',v_expenses
  );
end;
$$;
