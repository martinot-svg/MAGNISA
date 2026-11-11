
-- MAGNISA 0015: read-access hardening for sensitive financial, payroll and audit data.

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
  where organization_id=p_org
    and user_id=auth.uid()
    and status='active'
  limit 1;

  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;

  select allowed into v_override
  from public.role_permissions
  where organization_id=p_org
    and role=v_role
    and permission_key=p_permission
  limit 1;

  if found then return coalesce(v_override,false); end if;

  return case v_role
    when 'admin' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','invoices.cancel','payments.record',
      'expenses.record','treasury.transfer','suppliers.manage','payroll.manage','payroll.pay',
      'accounting.manage','reports.export','settings.manage','users.manage','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view'
    ])
    when 'director' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit','quotes.accept',
      'orders.manage','invoices.create','invoices.issue','payments.record','expenses.record',
      'treasury.transfer','suppliers.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','suppliers.view','reports.view'
    ])
    when 'finance_manager' then p_permission = any(array[
      'invoices.issue','invoices.cancel','payments.record','expenses.record','treasury.transfer',
      'suppliers.manage','payroll.pay','accounting.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view'
    ])
    when 'accountant' then p_permission = any(array[
      'invoices.issue','payments.record','expenses.record','suppliers.manage','payroll.manage',
      'accounting.manage','reports.export','audit.view',
      'treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view'
    ])
    when 'sales' then p_permission = any(array[
      'customers.create','services.create','quotes.create','quotes.edit'
    ])
    when 'cashier' then p_permission = any(array[
      'payments.record','expenses.record','treasury.view'
    ])
    when 'hr' then p_permission = any(array[
      'payroll.manage','payroll.view'
    ])
    when 'auditor' then p_permission = any(array[
      'reports.export','audit.view','accounting.view','reports.view'
    ])
    else false
  end;
end
$$;

-- Treasury and customer cash movements.
drop policy if exists financial_accounts_select on public.financial_accounts;
create policy financial_accounts_select on public.financial_accounts
for select to authenticated
using (public.has_org_permission(organization_id,'treasury.view'));

drop policy if exists financial_transactions_select on public.financial_transactions;
create policy financial_transactions_select on public.financial_transactions
for select to authenticated
using (public.has_org_permission(organization_id,'treasury.view'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
for select to authenticated
using (public.has_org_permission(organization_id,'treasury.view'));

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
for select to authenticated
using (public.has_org_permission(organization_id,'treasury.view'));

-- Finance / liabilities.
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

drop policy if exists partner_accounts_select on public.partner_accounts;
create policy partner_accounts_select on public.partner_accounts
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

drop policy if exists partner_account_movements_select on public.partner_account_movements;
create policy partner_account_movements_select on public.partner_account_movements
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

drop policy if exists tax_obligations_select on public.tax_obligations;
create policy tax_obligations_select on public.tax_obligations
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

drop policy if exists social_obligations_select on public.social_obligations;
create policy social_obligations_select on public.social_obligations
for select to authenticated
using (public.has_org_permission(organization_id,'finance.view'));

-- Supplier liabilities.
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
for select to authenticated
using (public.has_org_permission(organization_id,'suppliers.view'));

drop policy if exists supplier_invoices_select on public.supplier_invoices;
create policy supplier_invoices_select on public.supplier_invoices
for select to authenticated
using (public.has_org_permission(organization_id,'suppliers.view'));

drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
for select to authenticated
using (public.has_org_permission(organization_id,'suppliers.view'));

-- Payroll is highly sensitive.
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs
for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));

drop policy if exists payslips_select on public.payslips;
create policy payslips_select on public.payslips
for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));

drop policy if exists salary_advances_select on public.salary_advances;
create policy salary_advances_select on public.salary_advances
for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));

drop policy if exists payroll_payments_select on public.payroll_payments;
create policy payroll_payments_select on public.payroll_payments
for select to authenticated
using (public.has_org_permission(organization_id,'payroll.view'));

-- Accounting and audit.
drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries
for select to authenticated
using (public.has_org_permission(organization_id,'accounting.view'));

drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines
for select to authenticated
using (public.has_org_permission(organization_id,'accounting.view'));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
for select to authenticated
using (public.has_org_permission(organization_id,'audit.view'));
