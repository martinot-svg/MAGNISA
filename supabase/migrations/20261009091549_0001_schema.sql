create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  currency text not null default 'MGA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','director','finance_manager','accountant','sales','cashier','viewer')),
  status text not null default 'active' check (status in ('active','suspended','invited')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.company_settings (
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

create table public.number_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check(document_type in ('quote','invoice','credit_note','payment','expense')),
  prefix text not null,
  next_value bigint not null default 1 check(next_value > 0),
  padding integer not null default 5 check(padding between 1 and 12),
  updated_at timestamptz not null default now(),
  primary key(organization_id,document_type)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(char_length(trim(name)) >= 2),
  email text,
  phone text,
  address text,
  tax_id text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_org_name_idx on public.customers(organization_id,name);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  source text,
  status text not null default 'new' check(status in ('new','qualified','proposal','won','lost')),
  converted_customer_id uuid references public.customers(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  reference text,
  unit text not null default 'forfait',
  unit_price numeric(18,2) not null default 0 check(unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check(tax_rate >= 0 and tax_rate <= 100),
  direct_cost_estimate numeric(18,2) not null default 0 check(direct_cost_estimate >= 0),
  margin_target_pct numeric(7,4) check(margin_target_pct is null or (margin_target_pct >= 0 and margin_target_pct <= 100)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,reference)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  number text not null,
  version integer not null default 1 check(version > 0),
  status text not null default 'draft' check(status in ('draft','sent','negotiating','accepted','refused','expired','converted','cancelled')),
  issue_date date not null default current_date,
  valid_until date not null,
  subtotal numeric(18,2) not null default 0 check(subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check(discount_total >= 0),
  tax_total numeric(18,2) not null default 0 check(tax_total >= 0),
  total numeric(18,2) not null default 0 check(total >= 0),
  notes text,
  accepted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,number,version),
  check(valid_until >= issue_date)
);
create index quotes_org_status_idx on public.quotes(organization_id,status);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id),
  description text not null,
  quantity numeric(18,4) not null check(quantity > 0),
  unit text,
  unit_price numeric(18,2) not null check(unit_price >= 0),
  discount_pct numeric(7,4) not null default 0 check(discount_pct between 0 and 100),
  discount_amount numeric(18,2) not null default 0,
  taxable_amount numeric(18,2) not null default 0,
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  sort_order integer not null default 0
);
create index quote_lines_quote_idx on public.quote_lines(quote_id,sort_order);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  quote_id uuid references public.quotes(id),
  number text not null,
  status text not null default 'draft' check(status in ('draft','issued','partially_paid','paid','overdue','cancelled')),
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(18,2) not null default 0 check(subtotal >= 0),
  discount_total numeric(18,2) not null default 0 check(discount_total >= 0),
  tax_total numeric(18,2) not null default 0 check(tax_total >= 0),
  total numeric(18,2) not null default 0 check(total >= 0),
  paid_amount numeric(18,2) not null default 0 check(paid_amount >= 0),
  balance_due numeric(18,2) not null default 0 check(balance_due >= 0),
  notes text,
  issued_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,number),
  check(due_date is null or due_date >= issue_date),
  check(paid_amount <= total)
);
create index invoices_org_status_due_idx on public.invoices(organization_id,status,due_date);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_id uuid references public.services(id),
  description text not null,
  quantity numeric(18,4) not null check(quantity > 0),
  unit text,
  unit_price numeric(18,2) not null check(unit_price >= 0),
  discount_pct numeric(7,4) not null default 0 check(discount_pct between 0 and 100),
  discount_amount numeric(18,2) not null default 0,
  taxable_amount numeric(18,2) not null default 0,
  tax_rate numeric(7,4) not null default 0 check(tax_rate between 0 and 100),
  tax_amount numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  sort_order integer not null default 0
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id,sort_order);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null check(type in ('bank','cash','mobile_money','cheque_clearing')),
  balance numeric(18,2) not null default 0,
  external_reference text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  customer_id uuid not null references public.customers(id),
  financial_account_id uuid not null references public.financial_accounts(id),
  reference text,
  amount numeric(18,2) not null check(amount > 0),
  method text not null check(method in ('bank_transfer','cash','mobile_money','cheque','card','other')),
  status text not null default 'confirmed' check(status in ('pending_verification','confirmed','reconciled','cancelled')),
  paid_at date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index payments_org_date_idx on public.payments(organization_id,paid_at);
create unique index payments_org_reference_unique on public.payments(organization_id,reference) where reference is not null and reference <> '';

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id),
  description text not null,
  category text not null,
  amount numeric(18,2) not null check(amount > 0),
  expense_date date not null,
  status text not null default 'paid' check(status in ('draft','validated','paid','cancelled')),
  supplier_name text,
  project_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id),
  transaction_date date not null,
  amount numeric(18,2) not null check(amount <> 0),
  kind text not null check(kind in ('customer_payment','expense','transfer_in','transfer_out','adjustment','cheque_clearance')),
  source_type text not null,
  source_id uuid,
  reference text,
  description text,
  created_at timestamptz not null default now()
);
create index financial_transactions_org_account_date_idx on public.financial_transactions(organization_id,financial_account_id,transaction_date);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null,
  reference text not null,
  description text not null,
  source_type text not null,
  source_id uuid,
  status text not null default 'posted' check(status in ('draft','posted','reversed')),
  total_debit numeric(18,2) not null default 0,
  total_credit numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  check(total_debit = total_credit)
);
create index journal_entries_org_date_idx on public.journal_entries(organization_id,entry_date);

create table public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_key text not null,
  account_label text not null,
  debit numeric(18,2) not null default 0 check(debit >= 0),
  credit numeric(18,2) not null default 0 check(credit >= 0),
  customer_id uuid references public.customers(id),
  financial_account_id uuid references public.financial_accounts(id),
  check((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table public.tax_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_type text not null,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','declared','paid','overdue','cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.social_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organization_name text,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  status text not null default 'open' check(status in ('open','declared','paid','overdue','cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  revenue_budget numeric(18,2) not null default 0,
  expense_budget numeric(18,2) not null default 0,
  scenario text not null default 'normal' check(scenario in ('prudent','normal','optimistic')),
  created_at timestamptz not null default now(),
  unique(organization_id,period_start,period_end,scenario)
);

create table public.analysis_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_code text not null,
  title text not null,
  responsible_user_id uuid references auth.users(id),
  due_date date,
  amount numeric(18,2),
  status text not null default 'todo' check(status in ('todo','in_progress','done','no_effect','cancelled')),
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check(document_type in ('quote','invoice')),
  name text not null,
  is_default boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_date_idx on public.audit_logs(organization_id,created_at desc);