-- Loan contract terms, forecast installments and actual repayment ledger.
-- Financial postings are intentionally deferred to a dedicated transactional RPC.
alter table public.loans
  add column if not exists contract_reference text,
  add column if not exists repayment_method text not null default 'annuity',
  add column if not exists payment_frequency integer not null default 12,
  add column if not exists total_installments integer,
  add column if not exists first_due_date date,
  add column if not exists rate_type text not null default 'fixed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loans_repayment_method_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_repayment_method_check
      check (repayment_method in ('annuity','equal_principal','bullet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_payment_frequency_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_payment_frequency_check
      check (payment_frequency in (1,2,3,4,6,12));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_total_installments_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_total_installments_check
      check (total_installments is null or total_installments between 1 and 1200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_rate_type_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_rate_type_check
      check (rate_type in ('fixed','variable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_id_organization_unique' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_id_organization_unique unique (id, organization_id);
  end if;
end $$;

create table if not exists public.loan_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loan_id uuid not null,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  opening_principal numeric(20,2) not null check (opening_principal >= 0),
  principal_due numeric(20,2) not null check (principal_due >= 0),
  interest_due numeric(20,2) not null check (interest_due >= 0),
  fees_due numeric(20,2) not null default 0 check (fees_due >= 0),
  total_due numeric(20,2) not null check (total_due >= 0),
  closing_principal numeric(20,2) not null check (closing_principal >= 0),
  status text not null default 'planned' check (status in ('planned','partial','paid','overdue','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_installments_loan_org_fk
    foreign key (loan_id, organization_id) references public.loans(id, organization_id) on delete cascade,
  constraint loan_installments_number_unique unique (organization_id, loan_id, installment_number)
);

create index if not exists loan_installments_due_date_idx
  on public.loan_installments (organization_id, due_date, status);
create index if not exists loan_installments_loan_due_idx
  on public.loan_installments (loan_id, due_date);

create table if not exists public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  loan_id uuid not null,
  installment_id uuid,
  payment_date date not null,
  amount numeric(20,2) not null check (amount > 0),
  principal_paid numeric(20,2) not null default 0 check (principal_paid >= 0),
  interest_paid numeric(20,2) not null default 0 check (interest_paid >= 0),
  fees_paid numeric(20,2) not null default 0 check (fees_paid >= 0),
  penalty_paid numeric(20,2) not null default 0 check (penalty_paid >= 0),
  financial_account_id uuid,
  payment_reference text,
  notes text,
  status text not null default 'draft' check (status in ('draft','posted','reversed')),
  journal_entry_id uuid references public.journal_entries(id) on delete restrict,
  financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  request_key uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_repayments_loan_org_fk
    foreign key (loan_id, organization_id) references public.loans(id, organization_id) on delete restrict,
  constraint loan_repayments_installment_org_fk
    foreign key (installment_id, organization_id, loan_id)
    references public.loan_installments(id, organization_id, loan_id) on delete restrict,
  constraint loan_repayments_amount_split_check
    check (amount = principal_paid + interest_paid + fees_paid + penalty_paid),
  constraint loan_repayments_request_key_unique unique (organization_id, request_key)
);

create index if not exists loan_repayments_loan_date_idx
  on public.loan_repayments (organization_id, loan_id, payment_date desc);
create index if not exists loan_repayments_installment_idx
  on public.loan_repayments (installment_id) where installment_id is not null;

alter table public.loan_installments enable row level security;
alter table public.loan_repayments enable row level security;

drop policy if exists loan_installments_select on public.loan_installments;
create policy loan_installments_select on public.loan_installments
  for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.view'));

drop policy if exists loan_repayments_select on public.loan_repayments;
create policy loan_repayments_select on public.loan_repayments
  for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.view'));

revoke all on public.loan_installments from anon, authenticated;
revoke all on public.loan_repayments from anon, authenticated;
grant select on public.loan_installments to authenticated;
grant select on public.loan_repayments to authenticated;
