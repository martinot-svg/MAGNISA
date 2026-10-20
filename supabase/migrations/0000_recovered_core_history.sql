-- Recovered core baseline for the historical MAGNISA migration chain.
-- The production migration ledger retains the executed SQL statements. This file
-- restores the schema objects that the repository's later migrations depend on.
-- It is intentionally additive/idempotent so it is safe to replay locally.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  currency text not null default 'MGA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','director','finance_manager','accountant','sales','cashier','hr','auditor','employee','viewer')),
  status text not null default 'active' check (status in ('active','suspended','invited')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table if not exists public.company_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text,
  trade_name text,
  logo_url text,
  address text,
  phone text,
  email text,
  website text,
  tax_id text,
  stat_id text,
  registry_id text,
  bank_details text,
  payment_terms text,
  legal_mentions text,
  default_payment_days integer not null default 30 check(default_payment_days between 0 and 3650),
  updated_at timestamptz not null default now()
);

create table if not exists public.number_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null,
  prefix text not null,
  next_value bigint not null default 1 check(next_value > 0),
  padding integer not null default 5 check(padding between 1 and 12),
  updated_at timestamptz not null default now(),
  primary key(organization_id,document_type)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, email text, phone text, address text, tax_id text, notes text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists customers_org_name_idx on public.customers(organization_id,name);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, email text, phone text, source text,
  status text not null default 'new' check(status in ('new','qualified','proposal','won','lost')),
  converted_customer_id uuid references public.customers(id), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, description text, reference text, unit text not null default 'forfait',
  unit_price numeric(18,2) not null default 0 check(unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate >= 0 and tax_rate <= 100),
  direct_cost_estimate numeric(18,2) not null default 0 check(direct_cost_estimate >= 0),
  margin_target_pct numeric(7,4), is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,reference)
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id), number text not null, version integer not null default 1,
  status text not null default 'draft' check(status in ('draft','sent','negotiating','accepted','refused','expired','converted','cancelled')),
  issue_date date not null default current_date, valid_until date not null,
  subtotal numeric(18,2) not null default 0, discount_total numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0, notes text,
  accepted_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,number,version), check(valid_until >= issue_date)
);
create index if not exists quotes_org_status_idx on public.quotes(organization_id,status);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade, service_id uuid references public.services(id), description text not null,
  quantity numeric(18,4) not null check(quantity > 0), unit text, unit_price numeric(18,2) not null check(unit_price >= 0),
  discount_pct numeric(7,4) not null default 0 check(discount_pct between 0 and 100), discount_amount numeric(18,2) not null default 0,
  taxable_amount numeric(18,2) not null default 0, tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(18,2) not null default 0, line_total numeric(18,2) not null default 0, sort_order integer not null default 0
);
create index if not exists quote_lines_quote_idx on public.quote_lines(quote_id,sort_order);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id), quote_id uuid references public.quotes(id), number text not null,
  status text not null default 'draft' check(status in ('draft','issued','partially_paid','paid','overdue','cancelled')),
  issue_date date not null default current_date, due_date date,
  subtotal numeric(18,2) not null default 0, discount_total numeric(18,2) not null default 0, tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0, paid_amount numeric(18,2) not null default 0, balance_due numeric(18,2) not null default 0,
  notes text, issued_at timestamptz, cancelled_at timestamptz, cancellation_reason text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,number), check(due_date is null or due_date >= issue_date), check(paid_amount <= total)
);
create index if not exists invoices_org_status_due_idx on public.invoices(organization_id,status,due_date);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade, service_id uuid references public.services(id), description text not null,
  quantity numeric(18,4) not null check(quantity > 0), unit text, unit_price numeric(18,2) not null check(unit_price >= 0),
  discount_pct numeric(7,4) not null default 0 check(discount_pct between 0 and 100), discount_amount numeric(18,2) not null default 0,
  taxable_amount numeric(18,2) not null default 0, tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(18,2) not null default 0, line_total numeric(18,2) not null default 0, sort_order integer not null default 0
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id,sort_order);

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, type text not null check(type in ('bank','cash','mobile_money','cheque_clearing')),
  balance numeric(18,2) not null default 0, external_reference text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id), customer_id uuid not null references public.customers(id), financial_account_id uuid not null references public.financial_accounts(id),
  reference text, amount numeric(18,2) not null check(amount > 0), method text not null,
  status text not null default 'confirmed' check(status in ('pending_verification','confirmed','reconciled','cancelled')), paid_at date not null,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists payments_org_date_idx on public.payments(organization_id,paid_at);
create unique index if not exists payments_org_reference_unique on public.payments(organization_id,reference) where reference is not null and reference <> '';

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id), description text not null, category text not null,
  amount numeric(18,2) not null check(amount > 0), expense_date date not null,
  status text not null default 'paid' check(status in ('draft','validated','paid','cancelled')), supplier_name text, project_reference text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id), transaction_date date not null, amount numeric(18,2) not null check(amount <> 0),
  kind text not null, source_type text not null, source_id uuid, reference text, description text, created_at timestamptz not null default now()
);
create index if not exists financial_transactions_org_account_date_idx on public.financial_transactions(organization_id,financial_account_id,transaction_date);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null, reference text not null, description text not null, source_type text not null, source_id uuid,
  status text not null default 'posted' check(status in ('draft','posted','reversed')), total_debit numeric(18,2) not null default 0, total_credit numeric(18,2) not null default 0,
  created_at timestamptz not null default now(), check(total_debit = total_credit)
);
create index if not exists journal_entries_org_date_idx on public.journal_entries(organization_id,entry_date);

create table if not exists public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade, account_key text not null, account_label text not null,
  debit numeric(18,2) not null default 0 check(debit >= 0), credit numeric(18,2) not null default 0 check(credit >= 0),
  customer_id uuid references public.customers(id), financial_account_id uuid references public.financial_accounts(id),
  check((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists public.tax_obligations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_type text not null, period_start date not null, period_end date not null, due_date date not null,
  amount numeric(18,2) not null default 0, paid_amount numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','declared','paid','overdue','cancelled')), notes text, created_at timestamptz not null default now()
);

create table if not exists public.social_obligations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_name text, period_start date not null, period_end date not null, due_date date not null,
  amount numeric(18,2) not null default 0, paid_amount numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','declared','paid','overdue','cancelled')), notes text, created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null, period_end date not null, revenue_budget numeric(18,2) not null default 0, expense_budget numeric(18,2) not null default 0,
  scenario text not null default 'normal' check(scenario in ('prudent','normal','optimistic')), created_at timestamptz not null default now(), unique(organization_id,period_start,period_end,scenario)
);

create table if not exists public.analysis_actions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_code text not null, title text not null, responsible_user_id uuid references auth.users(id), due_date date, amount numeric(18,2),
  status text not null default 'todo' check(status in ('todo','in_progress','done','no_effect','cancelled')), result_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null, name text not null, is_default boolean not null default false, configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, old_values jsonb, new_values jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_date_idx on public.audit_logs(organization_id,created_at desc);

-- Extended service-company and payroll objects recovered from the production schema history.
create table if not exists public.organization_features (
  organization_id uuid not null references public.organizations(id) on delete cascade, feature_key text not null,
  enabled boolean not null default true, enabled_at timestamptz, enabled_by uuid references auth.users(id), disabled_at timestamptz,
  disabled_by uuid references auth.users(id), updated_at timestamptz not null default now(), primary key(organization_id,feature_key)
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id), name text not null, reference text,
  status text not null default 'planned' check(status in ('planned','active','on_hold','completed','cancelled')),
  start_date date, end_date date, target_margin_pct numeric(7,4), notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,reference)
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id), quote_id uuid references public.quotes(id), project_id uuid references public.projects(id), number text not null,
  status text not null default 'draft' check(status in ('draft','confirmed','in_progress','completed','cancelled')), order_date date not null default current_date,
  expected_completion_date date, subtotal numeric(18,2) not null default 0, tax_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,number)
);
create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade, service_id uuid references public.services(id), description text not null,
  quantity numeric(18,4) not null check(quantity > 0), unit text, unit_price numeric(18,2) not null check(unit_price >= 0), tax_rate numeric(7,4) not null default 0, line_total numeric(18,2) not null default 0, sort_order integer not null default 0
);
alter table public.invoices add column if not exists order_id uuid references public.orders(id);
alter table public.expenses add column if not exists project_id uuid references public.projects(id);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, email text, phone text, address text, tax_id text,
  supplier_type text not null default 'supplier' check(supplier_type in ('supplier','subcontractor','both')), payment_terms text, notes text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id), project_id uuid references public.projects(id), supplier_number text not null,
  invoice_date date not null, due_date date, subtotal numeric(18,2) not null default 0, tax_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0, balance_due numeric(18,2) not null default 0,
  status text not null default 'validated' check(status in ('draft','validated','partially_paid','paid','overdue','cancelled')), attachment_url text, notes text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,supplier_id,supplier_number)
);
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoices(id), supplier_id uuid not null references public.suppliers(id), financial_account_id uuid not null references public.financial_accounts(id),
  amount numeric(18,2) not null check(amount > 0), payment_date date not null, reference text, method text not null, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id), customer_id uuid not null references public.customers(id), number text not null, issue_date date not null default current_date,
  subtotal numeric(18,2) not null default 0, tax_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0 check(total >= 0), reason text not null,
  status text not null default 'issued' check(status in ('draft','issued','applied','cancelled')), created_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(organization_id,number)
);
create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id), invoice_id uuid references public.invoices(id), amount numeric(18,2) not null check(amount > 0), cheque_number text not null,
  issuing_bank text, received_date date not null, due_date date, status text not null default 'received' check(status in ('received','to_deposit','deposited','clearing','cleared','rejected','cancelled')),
  clearing_account_id uuid references public.financial_accounts(id), bank_account_id uuid references public.financial_accounts(id), attachment_url text, notes text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,cheque_number)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_number text, first_name text not null, last_name text not null, email text, phone text, job_title text, contract_type text,
  hire_date date, end_date date, base_salary numeric(18,2) not null default 0, payment_method text default 'bank_transfer', payment_details text,
  social_identifier text, health_identifier text, status text not null default 'active' check(status in ('active','suspended','left')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,employee_number)
);
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null, period_end date not null, status text not null default 'draft' check(status in ('draft','calculated','review','validated','partially_paid','paid','cancelled')),
  gross_total numeric(18,2) not null default 0, employee_deductions_total numeric(18,2) not null default 0, employer_contributions_total numeric(18,2) not null default 0,
  tax_withheld_total numeric(18,2) not null default 0, net_total numeric(18,2) not null default 0, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,period_start,period_end)
);
create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade, employee_id uuid not null references public.employees(id),
  base_salary numeric(18,2) not null default 0, bonuses numeric(18,2) not null default 0, overtime numeric(18,2) not null default 0, other_earnings numeric(18,2) not null default 0,
  employee_social numeric(18,2) not null default 0, employee_health numeric(18,2) not null default 0, income_tax numeric(18,2) not null default 0,
  advances_recovered numeric(18,2) not null default 0, other_deductions numeric(18,2) not null default 0, employer_social numeric(18,2) not null default 0, employer_health numeric(18,2) not null default 0,
  gross_pay numeric(18,2) not null default 0, net_pay numeric(18,2) not null default 0, paid_amount numeric(18,2) not null default 0,
  status text not null default 'draft' check(status in ('draft','calculated','validated','partially_paid','paid','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(payroll_run_id,employee_id)
);
create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id), financial_account_id uuid not null references public.financial_accounts(id), amount numeric(18,2) not null check(amount > 0), advance_date date not null,
  recovered_amount numeric(18,2) not null default 0, status text not null default 'open' check(status in ('open','partially_recovered','recovered','cancelled')), reference text,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id), employee_id uuid not null references public.employees(id), financial_account_id uuid not null references public.financial_accounts(id),
  amount numeric(18,2) not null check(amount > 0), payment_date date not null, method text not null, reference text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, category text, acquisition_date date not null, acquisition_cost numeric(18,2) not null check(acquisition_cost >= 0), useful_life_months integer,
  depreciation_method text not null default 'straight_line', accumulated_depreciation numeric(18,2) not null default 0, net_book_value numeric(18,2) not null default 0,
  status text not null default 'active' check(status in ('active','disposed','fully_depreciated')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  lender_name text not null, principal numeric(18,2) not null check(principal > 0), outstanding_principal numeric(18,2) not null check(outstanding_principal >= 0), interest_rate numeric(9,6), start_date date not null,
  end_date date, next_due_date date, next_due_amount numeric(18,2), status text not null default 'active' check(status in ('active','paid','defaulted','cancelled')), notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.partner_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, partner_name text not null, reference text, created_at timestamptz not null default now(), unique(organization_id,reference)
);
create table if not exists public.partner_account_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, partner_account_id uuid not null references public.partner_accounts(id) on delete cascade,
  financial_account_id uuid references public.financial_accounts(id), movement_date date not null, direction text not null check(direction in ('company_owes_partner','partner_owes_company')),
  amount numeric(18,2) not null check(amount > 0), kind text not null, reference text, notes text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

-- Compatibility table used by the historical email-hardening migration; it is removed later by that migration.
create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, email text not null, token text, created_at timestamptz not null default now()
);

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active');
$$;

create or replace function public.has_org_role(p_org uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='active' and m.role=any(p_roles));
$$;

create or replace function public.assert_org_access(p_org uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='active') then
    raise exception 'Accès refusé à cette organisation';
  end if;
end;
$$;

create or replace function public.has_org_permission(p_org uuid,p_permission text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_role text; v_override boolean;
begin
  if auth.uid() is null then return false; end if;
  select role into v_role from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='active' limit 1;
  if v_role is null then return false; end if;
  if v_role='owner' then return true; end if;
  select allowed into v_override from public.role_permissions where organization_id=p_org and role=v_role and permission_key=p_permission limit 1;
  if found then return coalesce(v_override,false); end if;
  return case v_role
    when 'admin' then true
    when 'director' then p_permission = any(array['customers.create','services.create','quotes.create','quotes.edit','quotes.accept','orders.manage','invoices.create','invoices.issue','payments.record','expenses.record','treasury.transfer','suppliers.manage','reports.export','audit.view','treasury.view','finance.view','accounting.view','suppliers.view','reports.view','sales.view','billing.view'])
    when 'finance_manager' then p_permission = any(array['invoices.issue','invoices.cancel','payments.record','expenses.record','treasury.transfer','suppliers.manage','payroll.pay','accounting.manage','reports.export','audit.view','treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view','billing.view'])
    when 'accountant' then p_permission = any(array['invoices.issue','payments.record','expenses.record','suppliers.manage','payroll.manage','accounting.manage','reports.export','audit.view','treasury.view','finance.view','accounting.view','payroll.view','suppliers.view','reports.view','billing.view'])
    when 'sales' then p_permission = any(array['customers.create','services.create','quotes.create','quotes.edit','sales.view','billing.view'])
    when 'cashier' then p_permission = any(array['payments.record','expenses.record','treasury.view','billing.view'])
    when 'hr' then p_permission = any(array['payroll.manage','payroll.view'])
    when 'auditor' then p_permission = any(array['reports.export','audit.view','accounting.view','reports.view','billing.view'])
    else false end;
end;
$$;

create or replace function public.assert_org_permission(p_org uuid,p_permission text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_org_permission(p_org,p_permission) then raise exception 'Action non autorisée pour ce rôle'; end if;
end;
$$;

create or replace function public.audit_event(p_org uuid,p_action text,p_entity text,p_id uuid,p_old jsonb default null,p_new jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values)
  values(p_org,auth.uid(),p_action,p_entity,p_id,p_old,p_new);
end;
$$;

create table if not exists public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null, permission_key text not null, allowed boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id), primary key(organization_id,role,permission_key)
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

DO $$
declare t text;
begin
  foreach t in array array['company_settings','number_sequences','customers','prospects','services','quotes','quote_lines','invoices','invoice_lines','financial_accounts','payments','expenses','financial_transactions','journal_entries','journal_entry_lines','tax_obligations','social_obligations','budgets','analysis_actions','document_templates','audit_logs','organization_features','projects','orders','order_lines','suppliers','supplier_invoices','supplier_payments','credit_notes','cheques','employees','payroll_runs','payslips','salary_advances','payroll_payments','fixed_assets','loans','partner_accounts','partner_account_movements','role_permissions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select using(public.is_org_member(organization_id))',t,t);
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('create policy %I_insert on public.%I for insert with check(public.is_org_member(organization_id))',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('create policy %I_update on public.%I for update using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id))',t,t);
  end loop;
end $$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid,text[]) to authenticated;
grant execute on function public.assert_org_access(uuid) to authenticated;
grant execute on function public.has_org_permission(uuid,text) to authenticated;
grant execute on function public.assert_org_permission(uuid,text) to authenticated;
