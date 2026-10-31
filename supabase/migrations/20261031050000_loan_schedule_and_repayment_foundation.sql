-- Loan contract terms, forecast installments and actual repayment ledger.
-- Financial postings are intentionally deferred to a dedicated transactional RPC.
alter table public.loans
  add column if not exists contract_reference text,
  add column if not exists repayment_method text not null default 'annuity',
  add column if not exists payment_frequency integer not null default 12,
  add column if not exists total_installments integer,
  add column if not exists first_due_date date,
  add column if not exists rate_type text not null default 'fixed',
  add column if not exists liability_account_code text,
  add column if not exists fee_account_code text,
  add column if not exists penalty_account_code text,
  add column if not exists repayment_allocation_order text not null default 'charges_first';

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
  if not exists (select 1 from pg_constraint where conname = 'loans_liability_account_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_liability_account_check
      check (liability_account_code is null or liability_account_code in ('164','168'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loans_repayment_allocation_order_check' and conrelid = 'public.loans'::regclass) then
    alter table public.loans add constraint loans_repayment_allocation_order_check
      check (repayment_allocation_order in ('charges_first','interest_first','principal_first'));
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
  penalty_due numeric(20,2) not null default 0 check (penalty_due >= 0),
  total_due numeric(20,2) not null check (total_due >= 0),
  closing_principal numeric(20,2) not null check (closing_principal >= 0),
  status text not null default 'planned' check (status in ('planned','partial','paid','overdue','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_installments_loan_org_fk
    foreign key (loan_id, organization_id) references public.loans(id, organization_id) on delete cascade,
  constraint loan_installments_number_unique unique (organization_id, loan_id, installment_number),
  constraint loan_installments_id_org_loan_unique unique (id, organization_id, loan_id)
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

-- Persist a server-calculated schedule atomically. The caller cannot directly
-- insert or update schedule rows; only this validated function can do so.
create or replace function public.create_loan_schedule(
  p_organization_id uuid,
  p_loan_id uuid,
  p_installments jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan public.loans%rowtype;
  v_item jsonb;
  v_count integer := 0;
  v_number integer;
  v_opening numeric(20,2);
  v_principal numeric(20,2);
  v_interest numeric(20,2);
  v_fees numeric(20,2);
  v_total numeric(20,2);
  v_closing numeric(20,2);
  v_expected_opening numeric(20,2);
  v_periodic_rate numeric;
  v_regular_payment numeric;
  v_expected_principal numeric(20,2);
  v_expected_interest numeric(20,2);
  v_expected_due_date date;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');

  if p_installments is null or jsonb_typeof(p_installments) <> 'array'
     or jsonb_array_length(p_installments) < 1
     or jsonb_array_length(p_installments) > 1200 then
    raise exception 'Échéancier invalide';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id and organization_id = p_organization_id
  for update;

  if not found then raise exception 'Emprunt introuvable'; end if;
  if exists (select 1 from public.loan_installments where loan_id = p_loan_id and organization_id = p_organization_id) then
    raise exception 'Un échéancier existe déjà pour cet emprunt';
  end if;
  if v_loan.total_installments is not null and jsonb_array_length(p_installments) <> v_loan.total_installments then
    raise exception 'Le nombre d’échéances ne correspond pas au contrat';
  end if;

  v_expected_opening := round(v_loan.outstanding_principal, 2);
  v_periodic_rate := coalesce(v_loan.interest_rate, 0) / 100 / v_loan.payment_frequency;
  v_regular_payment := case
    when v_periodic_rate = 0 then round(v_loan.outstanding_principal / v_loan.total_installments, 2)
    else v_loan.outstanding_principal * v_periodic_rate / (1 - power(1 + v_periodic_rate, -v_loan.total_installments))
  end;

  for v_item in select value from jsonb_array_elements(p_installments) loop
    v_count := v_count + 1;
    v_number := (v_item->>'number')::integer;
    v_opening := round((v_item->>'openingPrincipal')::numeric, 2);
    v_principal := round((v_item->>'principal')::numeric, 2);
    v_interest := round((v_item->>'interest')::numeric, 2);
    v_fees := round(coalesce((v_item->>'fees')::numeric, 0), 2);
    v_total := round((v_item->>'payment')::numeric, 2);
    v_closing := round((v_item->>'closingPrincipal')::numeric, 2);
    v_expected_due_date := (v_loan.first_due_date + make_interval(months => (v_count - 1) * (12 / v_loan.payment_frequency)))::date;
    v_expected_interest := round(v_expected_opening * v_periodic_rate, 2);
    v_expected_principal := case
      when v_loan.repayment_method = 'bullet' then case when v_count = v_loan.total_installments then v_expected_opening else 0 end
      when v_loan.repayment_method = 'equal_principal' then case when v_count = v_loan.total_installments then v_expected_opening else least(v_expected_opening, round(v_loan.principal / v_loan.total_installments, 2)) end
      else case when v_count = v_loan.total_installments then v_expected_opening else least(v_expected_opening, round(v_regular_payment - v_expected_interest, 2)) end
    end;

    if v_number <> v_count or v_opening <> v_expected_opening
       or v_principal < 0 or v_interest < 0 or v_fees < 0
       or v_total <> v_principal + v_interest + v_fees
       or v_closing <> v_opening - v_principal
       or v_closing < 0
       or v_principal <> v_expected_principal
       or v_interest <> v_expected_interest
       or v_fees <> 0
       or (v_item->>'dueDate')::date <> v_expected_due_date then
      raise exception 'Ligne d’échéancier invalide à la position %', v_count;
    end if;

    insert into public.loan_installments(
      organization_id, loan_id, installment_number, due_date,
      opening_principal, principal_due, interest_due, fees_due,
      total_due, closing_principal
    ) values (
      p_organization_id, p_loan_id, v_count, (v_item->>'dueDate')::date,
      v_opening, v_principal, v_interest, v_fees,
      v_total, v_closing
    );

    v_expected_opening := v_closing;
  end loop;

  if v_expected_opening <> 0 then
    raise exception 'L’échéancier ne rembourse pas intégralement le capital';
  end if;

  update public.loans
  set first_due_date = (p_installments->0->>'dueDate')::date,
      next_due_date = (p_installments->0->>'dueDate')::date,
      next_due_amount = (p_installments->0->>'payment')::numeric,
      updated_at = now()
  where id = p_loan_id and organization_id = p_organization_id;

  perform public.audit_event(
    p_organization_id,
    'loan.schedule_created',
    'loan',
    p_loan_id,
    null,
    jsonb_build_object('installments', v_count)
  );

  return v_count;
end;
$function$;

revoke all on function public.create_loan_schedule(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_loan_schedule(uuid, uuid, jsonb) to authenticated;

-- Create the contract and its initial forecast schedule in one database transaction.
create or replace function public.create_loan_with_schedule(
  p_organization_id uuid,
  p_lender_name text,
  p_principal numeric,
  p_interest_rate numeric,
  p_start_date date,
  p_end_date date,
  p_notes text,
  p_contract_reference text,
  p_repayment_method text,
  p_payment_frequency integer,
  p_total_installments integer,
  p_first_due_date date,
  p_liability_account_code text,
  p_fee_account_code text,
  p_penalty_account_code text,
  p_repayment_allocation_order text,
  p_installments jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_loan_id uuid;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id, 'finance.view');
  perform public.assert_org_permission(p_organization_id, 'treasury.transfer');

  if length(btrim(coalesce(p_lender_name,''))) < 2 or length(btrim(p_lender_name)) > 160 then
    raise exception 'Nom du prêteur invalide';
  end if;
  if p_principal is null or p_principal <= 0 then raise exception 'Capital invalide'; end if;
  if p_interest_rate is null or p_interest_rate < 0 or p_interest_rate > 1000 then raise exception 'Taux invalide'; end if;
  if p_start_date is null or p_first_due_date is null or p_first_due_date < p_start_date then
    raise exception 'Dates du contrat invalides';
  end if;
  if p_repayment_method not in ('annuity','equal_principal','bullet') then raise exception 'Méthode de remboursement invalide'; end if;
  if p_liability_account_code not in ('164','168') then raise exception 'Compte de dette invalide'; end if;
  if p_repayment_allocation_order not in ('charges_first','interest_first','principal_first') then raise exception 'Ordre d’imputation des remboursements invalide'; end if;
  if p_fee_account_code is not null and not exists (select 1 from public.pcg2005_accounts where code=p_fee_account_code) then raise exception 'Compte de frais absent du plan comptable'; end if;
  if p_penalty_account_code is not null and not exists (select 1 from public.pcg2005_accounts where code=p_penalty_account_code) then raise exception 'Compte de pénalités absent du plan comptable'; end if;
  if p_payment_frequency not in (1,2,3,4,6,12) then raise exception 'Périodicité invalide'; end if;
  if p_total_installments is null or p_total_installments < 1 or p_total_installments > 1200 then raise exception 'Durée invalide'; end if;
  if p_end_date is not null and p_end_date < (p_first_due_date + make_interval(months => (p_total_installments - 1) * (12 / p_payment_frequency)))::date then raise exception 'La date de fin précède la dernière échéance calculée'; end if;
  if jsonb_array_length(coalesce(p_installments,'[]'::jsonb)) <> p_total_installments then
    raise exception 'Nombre d’échéances incohérent';
  end if;

  insert into public.loans(
    organization_id, lender_name, principal, outstanding_principal, interest_rate,
    start_date, end_date, next_due_date, next_due_amount, status, notes,
    contract_reference, repayment_method, payment_frequency, total_installments, first_due_date,
    liability_account_code, fee_account_code, penalty_account_code, repayment_allocation_order
  ) values (
    p_organization_id, btrim(p_lender_name), round(p_principal,2), round(p_principal,2), p_interest_rate,
    p_start_date, p_end_date, p_first_due_date, null, 'active', nullif(btrim(coalesce(p_notes,'')),''),
    nullif(btrim(coalesce(p_contract_reference,'')),''), p_repayment_method, p_payment_frequency,
    p_total_installments, p_first_due_date,
    p_liability_account_code, p_fee_account_code, p_penalty_account_code, p_repayment_allocation_order
  ) returning id into v_loan_id;

  perform public.create_loan_schedule(p_organization_id, v_loan_id, p_installments);
  return v_loan_id;
end;
$function$;

revoke all on function public.create_loan_with_schedule(uuid,text,numeric,numeric,date,date,text,text,text,integer,integer,date,text,text,text,text,jsonb) from public, anon;
grant execute on function public.create_loan_with_schedule(uuid,text,numeric,numeric,date,date,text,text,text,integer,integer,date,text,text,text,text,jsonb) to authenticated;
