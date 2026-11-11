-- MAGNISA V3: branding, feature flags and extended service-company modules.
alter table public.company_settings
  add column if not exists slogan text,
  add column if not exists primary_color text default '#1663FF',
  add column if not exists secondary_color text default '#7B4DFF',
  add column if not exists accent_color text default '#D93CFF',
  add column if not exists font_family text default 'Inter',
  add column if not exists logo_storage_path text,
  add column if not exists signature_url text,
  add column if not exists stamp_url text;

create table if not exists public.organization_features (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id),
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(organization_id, feature_key)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id),
  name text not null,
  reference text,
  status text not null default 'planned' check(status in ('planned','active','on_hold','completed','cancelled')),
  start_date date,
  end_date date,
  target_margin_pct numeric(7,4),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, reference)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  quote_id uuid references public.quotes(id),
  project_id uuid references public.projects(id),
  number text not null,
  status text not null default 'draft' check(status in ('draft','confirmed','in_progress','completed','cancelled')),
  order_date date not null default current_date,
  expected_completion_date date,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,number)
);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid references public.services(id),
  description text not null,
  quantity numeric(18,4) not null check(quantity > 0),
  unit text,
  unit_price numeric(18,2) not null check(unit_price >= 0),
  tax_rate numeric(7,4) not null default 0,
  line_total numeric(18,2) not null default 0,
  sort_order integer not null default 0
);

alter table public.invoices add column if not exists order_id uuid references public.orders(id);
alter table public.expenses add column if not exists project_id uuid references public.projects(id);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  tax_id text,
  supplier_type text not null default 'supplier' check(supplier_type in ('supplier','subcontractor','both')),
  payment_terms text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  project_id uuid references public.projects(id),
  supplier_number text not null,
  invoice_date date not null,
  due_date date,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  balance_due numeric(18,2) not null default 0,
  status text not null default 'validated' check(status in ('draft','validated','partially_paid','paid','overdue','cancelled')),
  attachment_url text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,supplier_id,supplier_number)
);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoices(id),
  supplier_id uuid not null references public.suppliers(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  amount numeric(18,2) not null check(amount > 0),
  payment_date date not null,
  reference text,
  method text not null check(method in ('bank_transfer','cash','mobile_money','cheque','card','other')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid not null references public.customers(id),
  number text not null,
  issue_date date not null default current_date,
  subtotal numeric(18,2) not null default 0,
  tax_total numeric(18,2) not null default 0,
  total numeric(18,2) not null check(total >= 0),
  reason text not null,
  status text not null default 'issued' check(status in ('draft','issued','applied','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,number)
);

create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id),
  invoice_id uuid references public.invoices(id),
  amount numeric(18,2) not null check(amount > 0),
  cheque_number text not null,
  issuing_bank text,
  received_date date not null,
  due_date date,
  status text not null default 'received' check(status in ('received','to_deposit','deposited','clearing','cleared','rejected','cancelled')),
  clearing_account_id uuid references public.financial_accounts(id),
  bank_account_id uuid references public.financial_accounts(id),
  attachment_url text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,cheque_number)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_number text,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  job_title text,
  contract_type text,
  hire_date date,
  end_date date,
  base_salary numeric(18,2) not null default 0,
  payment_method text default 'bank_transfer',
  payment_details text,
  social_identifier text,
  health_identifier text,
  status text not null default 'active' check(status in ('active','suspended','left')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,employee_number)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check(status in ('draft','calculated','review','validated','partially_paid','paid','cancelled')),
  gross_total numeric(18,2) not null default 0,
  employee_deductions_total numeric(18,2) not null default 0,
  employer_contributions_total numeric(18,2) not null default 0,
  tax_withheld_total numeric(18,2) not null default 0,
  net_total numeric(18,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,period_start,period_end)
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  base_salary numeric(18,2) not null default 0,
  bonuses numeric(18,2) not null default 0,
  overtime numeric(18,2) not null default 0,
  other_earnings numeric(18,2) not null default 0,
  employee_social numeric(18,2) not null default 0,
  employee_health numeric(18,2) not null default 0,
  income_tax numeric(18,2) not null default 0,
  advances_recovered numeric(18,2) not null default 0,
  other_deductions numeric(18,2) not null default 0,
  employer_social numeric(18,2) not null default 0,
  employer_health numeric(18,2) not null default 0,
  gross_pay numeric(18,2) not null default 0,
  net_pay numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  status text not null default 'draft' check(status in ('draft','calculated','validated','partially_paid','paid','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_run_id,employee_id)
);

create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  amount numeric(18,2) not null check(amount > 0),
  advance_date date not null,
  recovered_amount numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','partially_recovered','recovered','cancelled')),
  reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id),
  employee_id uuid not null references public.employees(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  amount numeric(18,2) not null check(amount > 0),
  payment_date date not null,
  method text not null check(method in ('bank_transfer','cash','mobile_money','cheque','other')),
  reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text,
  acquisition_date date not null,
  acquisition_cost numeric(18,2) not null check(acquisition_cost >= 0),
  useful_life_months integer check(useful_life_months is null or useful_life_months > 0),
  depreciation_method text not null default 'straight_line',
  accumulated_depreciation numeric(18,2) not null default 0,
  net_book_value numeric(18,2) not null default 0,
  status text not null default 'active' check(status in ('active','disposed','fully_depreciated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lender_name text not null,
  principal numeric(18,2) not null check(principal > 0),
  outstanding_principal numeric(18,2) not null check(outstanding_principal >= 0),
  interest_rate numeric(9,6),
  start_date date not null,
  end_date date,
  next_due_date date,
  next_due_amount numeric(18,2),
  status text not null default 'active' check(status in ('active','paid','defaulted','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_name text not null,
  reference text,
  created_at timestamptz not null default now(),
  unique(organization_id,reference)
);

create table if not exists public.partner_account_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_account_id uuid not null references public.partner_accounts(id) on delete cascade,
  financial_account_id uuid references public.financial_accounts(id),
  movement_date date not null,
  direction text not null check(direction in ('company_owes_partner','partner_owes_company')),
  amount numeric(18,2) not null check(amount > 0),
  kind text not null,
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into public.organization_features(organization_id,feature_key,enabled,enabled_at)
select o.id, f.key, f.enabled, now()
from public.organizations o
cross join (values
 ('dashboard',true),('clients',true),('services',true),('prospects',true),('quotes',true),('orders',true),('invoices',true),('credit_notes',true),('payments',true),
 ('projects',true),('suppliers',true),('expenses',true),('treasury',true),('cheques',true),('receivables',true),('debts',true),('partner_accounts',true),('loans',true),
 ('payroll',false),('tax_social',true),('budget',true),('forecast',true),('smart_analysis',true),('accounting',true),('financial_statements',true),('reports',true),
 ('document_templates',true),('users',true),('audit',true)
) as f(key,enabled)
on conflict(organization_id,feature_key) do nothing;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('organization-branding','organization-branding',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;

create or replace function public.initialize_organization_features()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.organization_features(organization_id,feature_key,enabled,enabled_at)
  select new.id, f.key, f.enabled, now()
  from (values
   ('dashboard',true),('clients',true),('services',true),('prospects',true),('quotes',true),('orders',true),('invoices',true),('credit_notes',true),('payments',true),
   ('projects',true),('suppliers',true),('expenses',true),('treasury',true),('cheques',true),('receivables',true),('debts',true),('partner_accounts',true),('loans',true),
   ('payroll',false),('tax_social',true),('budget',true),('forecast',true),('smart_analysis',true),('accounting',true),('financial_statements',true),('reports',true),
   ('document_templates',true),('users',true),('audit',true)
  ) as f(key,enabled)
  on conflict(organization_id,feature_key) do nothing;
  return new;
end $$;

drop trigger if exists organizations_initialize_features on public.organizations;
create trigger organizations_initialize_features after insert on public.organizations for each row execute function public.initialize_organization_features();