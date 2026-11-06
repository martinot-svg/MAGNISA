-- MAGNISA: configurable prospect commission engine
-- Policy-driven calculation, percentage allocation, finance approval and traceable payments.
create unique index prospects_id_org_unique on public.prospects(id, organization_id);
create unique index customers_id_org_unique on public.customers(id, organization_id);

create table public.commission_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
  description text,
  is_active boolean not null default false,
  effective_from date not null default current_date,
  effective_until date,
  calculation_basis text not null check (calculation_basis in ('order_total','invoice_paid_amount','fixed_amount')),
  commission_rate numeric(9,4) not null default 100 check (commission_rate > 0 and commission_rate <= 100),
  fixed_basis_amount numeric(18,2),
  currency text not null default 'MGA',
  expense_account_code text not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, organization_id),
  check (effective_until is null or effective_until >= effective_from),
  check ((calculation_basis = 'fixed_amount' and fixed_basis_amount is not null and fixed_basis_amount > 0) or (calculation_basis <> 'fixed_amount' and fixed_basis_amount is null))
);

create unique index commission_policies_one_active_per_org
  on public.commission_policies(organization_id) where is_active;

create table public.commission_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null,
  contribution_type text not null check (contribution_type in ('originator','qualifier','negotiator','closer')),
  share_percentage numeric(7,4) not null check (share_percentage > 0 and share_percentage <= 100),
  created_at timestamptz not null default now(),
  foreign key (policy_id, organization_id) references public.commission_policies(id, organization_id) on delete cascade,
  unique(policy_id, contribution_type),
  unique(id, organization_id)
);

create table public.prospect_contributors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null,
  user_id uuid not null references auth.users(id),
  contribution_type text not null check (contribution_type in ('originator','qualifier','negotiator','closer')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key (prospect_id, organization_id) references public.prospects(id, organization_id) on delete cascade,
  unique(organization_id, prospect_id, user_id, contribution_type)
);

create table public.commission_calculations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null,
  customer_id uuid not null,
  policy_id uuid not null references public.commission_policies(id),
  source_document_type text check (source_document_type in ('order','invoice')),
  source_document_id uuid,
  basis_amount numeric(18,2) not null check (basis_amount > 0),
  commission_rate numeric(9,4) not null check (commission_rate > 0 and commission_rate <= 100),
  commission_total numeric(18,2) not null check (commission_total > 0),
  currency text not null,
  policy_snapshot jsonb not null,
  status text not null default 'calculated' check (status in ('calculated','approved','rejected','partially_paid','paid')),
  calculated_by uuid not null references auth.users(id),
  calculated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  request_key uuid not null,
  unique(organization_id, request_key),
  unique(id, organization_id),
  foreign key (prospect_id, organization_id) references public.prospects(id, organization_id),
  foreign key (customer_id, organization_id) references public.customers(id, organization_id),
  foreign key (policy_id, organization_id) references public.commission_policies(id, organization_id),
  check ((source_document_type is null) = (source_document_id is null)),
  check ((status = 'calculated' and approved_by is null and approved_at is null and rejection_reason is null)
      or (status in ('approved','partially_paid','paid') and approved_by is not null and approved_at is not null and rejection_reason is null)
      or (status = 'rejected' and approved_by is not null and approved_at is not null and length(trim(coalesce(rejection_reason,''))) > 0))
);

create table public.commission_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calculation_id uuid not null,
  user_id uuid not null references auth.users(id),
  contribution_type text not null check (contribution_type in ('originator','qualifier','negotiator','closer')),
  share_percentage numeric(12,8) not null check (share_percentage > 0 and share_percentage <= 100),
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  foreign key (calculation_id, organization_id) references public.commission_calculations(id, organization_id) on delete cascade,
  unique(calculation_id, user_id, contribution_type),
  unique(id, organization_id)
);

create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allocation_id uuid not null,
  financial_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  expense_id uuid not null unique references public.expenses(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  paid_at date not null,
  payment_reference text not null,
  recorded_by uuid not null references auth.users(id),
  request_key uuid not null,
  request_digest text not null,
  created_at timestamptz not null default now(),
  foreign key (allocation_id, organization_id) references public.commission_allocations(id, organization_id),
  unique(organization_id, request_key),
  unique(organization_id, allocation_id, payment_reference)
);

create unique index commission_calculations_source_unique
  on public.commission_calculations(organization_id, prospect_id, policy_id,
    coalesce(source_document_type,''), coalesce(source_document_id,'00000000-0000-0000-0000-000000000000'::uuid));

create index prospect_contributors_prospect_idx on public.prospect_contributors(organization_id, prospect_id);
create index prospect_contributors_user_idx on public.prospect_contributors(organization_id, user_id);
create index commission_calculations_status_idx on public.commission_calculations(organization_id, status, calculated_at desc);
create index commission_allocations_user_idx on public.commission_allocations(organization_id, user_id);
create index commission_payments_allocation_idx on public.commission_payments(organization_id, allocation_id, paid_at);

-- Extend the existing centralized permission resolver. Finance approval/payment is not granted to sales roles.
create or replace function public.has_org_permission(p_org uuid,p_permission text)
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
  if p_permission = 'commissions.approve' or p_permission = 'commissions.pay' then
    return v_role in ('finance_manager','accountant');
  end if;
  if v_role='owner' then return true; end if;

  select allowed into v_override
  from public.role_permissions
  where organization_id=p_org and role=v_role and permission_key=p_permission
  limit 1;
  if found then return coalesce(v_override,false); end if;

  if p_permission = 'prospects.convert' then
    return v_role in ('admin','director','finance_manager','accountant','sales','cashier','hr','employee');
  end if;
  if p_permission = 'commissions.policy.manage' then
    return v_role in ('admin','finance_manager');
  end if;
  if p_permission = 'commissions.view_team' or p_permission = 'commissions.audit' then
    return v_role in ('admin','director','finance_manager','accountant','auditor');
  end if;
  if p_permission = 'commissions.contribute' or p_permission = 'commissions.view_own' or p_permission = 'commissions.calculate' then
    return v_role in ('admin','director','finance_manager','accountant','sales','cashier','hr','employee');
  end if;

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
    when 'sales' then p_permission = any(array['customers.create','services.create','quotes.create','quotes.edit','sales.view','billing.view'])
    when 'cashier' then p_permission = any(array['payments.record','expenses.record','treasury.view','billing.view'])
    when 'hr' then p_permission = any(array['payroll.manage','payroll.view'])
    when 'auditor' then p_permission = any(array['reports.export','audit.view','accounting.view','reports.view','billing.view'])
    else false
  end;
end;
$$;

alter table public.commission_policies enable row level security;
alter table public.commission_policy_rules enable row level security;
alter table public.prospect_contributors enable row level security;
alter table public.commission_calculations enable row level security;
alter table public.commission_allocations enable row level security;
alter table public.commission_payments enable row level security;

create policy commission_policies_select on public.commission_policies for select to authenticated
using (public.has_org_permission(organization_id,'commissions.policy.manage')
    or public.has_org_permission(organization_id,'commissions.calculate')
    or public.has_org_permission(organization_id,'commissions.view_own'));
create policy commission_policies_insert on public.commission_policies for insert to authenticated
with check (public.has_org_permission(organization_id,'commissions.policy.manage') and created_by=auth.uid());
create policy commission_policies_update on public.commission_policies for update to authenticated
using (public.has_org_permission(organization_id,'commissions.policy.manage'))
with check (public.has_org_permission(organization_id,'commissions.policy.manage'));

create policy commission_policy_rules_select on public.commission_policy_rules for select to authenticated
using (public.has_org_permission(organization_id,'commissions.policy.manage')
    or public.has_org_permission(organization_id,'commissions.calculate')
    or public.has_org_permission(organization_id,'commissions.view_own'));
create policy commission_policy_rules_insert on public.commission_policy_rules for insert to authenticated
with check (public.has_org_permission(organization_id,'commissions.policy.manage'));
create policy commission_policy_rules_update on public.commission_policy_rules for update to authenticated
using (public.has_org_permission(organization_id,'commissions.policy.manage'))
with check (public.has_org_permission(organization_id,'commissions.policy.manage'));
create policy commission_policy_rules_delete on public.commission_policy_rules for delete to authenticated
using (public.has_org_permission(organization_id,'commissions.policy.manage'));

create policy prospects_commissions_select on public.prospects for select to authenticated
using (public.has_org_permission(organization_id,'commissions.contribute'));

create policy prospect_contributors_select on public.prospect_contributors for select to authenticated
using (user_id=auth.uid() or public.has_org_permission(organization_id,'commissions.view_team')
    or public.has_org_permission(organization_id,'commissions.audit'));
create policy prospect_contributors_insert on public.prospect_contributors for insert to authenticated
with check (user_id=auth.uid() and created_by=auth.uid()
    and public.has_org_permission(organization_id,'commissions.contribute'));

create policy commission_calculations_select on public.commission_calculations for select to authenticated
using (public.has_org_permission(organization_id,'commissions.view_team')
    or public.has_org_permission(organization_id,'commissions.audit')
    or exists(select 1 from public.commission_allocations a where a.calculation_id=commission_calculations.id and a.organization_id=commission_calculations.organization_id and a.user_id=auth.uid()));
create policy commission_calculations_insert on public.commission_calculations for insert to authenticated
with check (calculated_by=auth.uid() and public.has_org_permission(organization_id,'commissions.calculate'));
create policy commission_calculations_update on public.commission_calculations for update to authenticated
using (public.has_org_permission(organization_id,'commissions.approve'))
with check (public.has_org_permission(organization_id,'commissions.approve'));

create policy commission_allocations_select on public.commission_allocations for select to authenticated
using (user_id=auth.uid() or public.has_org_permission(organization_id,'commissions.view_team')
    or public.has_org_permission(organization_id,'commissions.audit'));
create policy commission_allocations_insert on public.commission_allocations for insert to authenticated
with check (public.has_org_permission(organization_id,'commissions.calculate'));

create policy commission_payments_select on public.commission_payments for select to authenticated
using (public.has_org_permission(organization_id,'commissions.view_team')
    or public.has_org_permission(organization_id,'commissions.audit')
    or exists(select 1 from public.commission_allocations a where a.id=commission_payments.allocation_id and a.organization_id=commission_payments.organization_id and a.user_id=auth.uid()));
create policy commission_payments_insert on public.commission_payments for insert to authenticated
with check (recorded_by=auth.uid() and public.has_org_permission(organization_id,'commissions.pay'));

revoke all on table
  public.commission_policies,
  public.commission_policy_rules,
  public.prospect_contributors,
  public.commission_calculations,
  public.commission_allocations,
  public.commission_payments
from anon, authenticated, public;

grant select on public.commission_policies to authenticated;
grant select on public.commission_policy_rules to authenticated;
grant select, insert on public.prospect_contributors to authenticated;
grant select on public.commission_calculations to authenticated;
grant select on public.commission_allocations to authenticated;
grant select on public.commission_payments to authenticated;

-- Calculate from a policy-defined, database-verified source. A prospect must already be converted.
create or replace function public.calculate_prospect_commission(
  p_org uuid,
  p_prospect uuid,
  p_policy uuid,
  p_source_document_type text,
  p_source_document_id uuid,
  p_request_key uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prospect public.prospects%rowtype;
  v_policy public.commission_policies%rowtype;
  v_org_currency text;
  v_basis numeric(18,2);
  v_total numeric(18,2);
  v_roles integer;
  v_rules integer;
  v_share_total numeric(9,4);
  v_calculation uuid;
  v_rule_snapshot jsonb;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.calculate') then
    raise exception 'Action non autorisée.';
  end if;
  if p_request_key is null then raise exception 'Clé de demande obligatoire.'; end if;

  select id into v_calculation from public.commission_calculations
  where organization_id=p_org and request_key=p_request_key;
  if v_calculation is not null then return v_calculation; end if;

  select * into v_prospect from public.prospects
  where id=p_prospect and organization_id=p_org for update;
  if not found or v_prospect.converted_customer_id is null or v_prospect.status <> 'won' then
    raise exception 'Le prospect doit être converti en client avant le calcul de la prime.';
  end if;

  select * into v_policy from public.commission_policies
  where id=p_policy and organization_id=p_org and is_active
    and effective_from <= current_date and (effective_until is null or effective_until >= current_date);
  if not found then raise exception 'Aucune politique de prime active applicable.'; end if;

  select currency into v_org_currency from public.organizations where id=p_org;
  if not found or v_policy.currency is distinct from v_org_currency then
    raise exception 'La devise de la politique ne correspond pas à la devise de l''organisation.';
  end if;

  if v_policy.calculation_basis='fixed_amount' then
    if p_source_document_type is not null or p_source_document_id is not null then
      raise exception 'Une politique à montant fixe ne doit pas recevoir de pièce source.';
    end if;
    v_basis := v_policy.fixed_basis_amount;
  elsif v_policy.calculation_basis='order_total' then
    if p_source_document_type <> 'order' or p_source_document_id is null then raise exception 'Commande source obligatoire.'; end if;
    select total into v_basis from public.orders
      where id=p_source_document_id and organization_id=p_org and customer_id=v_prospect.converted_customer_id;
  elsif v_policy.calculation_basis='invoice_paid_amount' then
    if p_source_document_type <> 'invoice' or p_source_document_id is null then raise exception 'Facture source obligatoire.'; end if;
    select paid_amount into v_basis from public.invoices
      where id=p_source_document_id and organization_id=p_org and customer_id=v_prospect.converted_customer_id
        and status <> 'cancelled' and balance_due <= 0 and paid_amount > 0;
  end if;
  if coalesce(v_basis,0) <= 0 then raise exception 'La base financière vérifiée est nulle ou introuvable.'; end if;

  select count(distinct c.contribution_type), count(distinct r.contribution_type), coalesce(sum(r.share_percentage),0)
    into v_roles, v_rules, v_share_total
  from (select distinct contribution_type from public.prospect_contributors
        where organization_id=p_org and prospect_id=p_prospect) c
  left join public.commission_policy_rules r
    on r.policy_id=v_policy.id and r.organization_id=p_org and r.contribution_type=c.contribution_type;
  if v_roles=0 or v_rules<>v_roles or v_share_total<=0 then
    raise exception 'Chaque rôle contributeur doit être couvert par la politique avec un pourcentage positif.';
  end if;

  v_total := round(v_basis * v_policy.commission_rate / 100, 2);
  if v_total <= 0 then raise exception 'Le montant de prime calculé est nul.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('contribution_type',contribution_type,'share_percentage',share_percentage)
      order by contribution_type),'[]'::jsonb)
    into v_rule_snapshot from public.commission_policy_rules where policy_id=v_policy.id and organization_id=p_org;

  insert into public.commission_calculations(
    organization_id,prospect_id,customer_id,policy_id,source_document_type,source_document_id,
    basis_amount,commission_rate,commission_total,currency,policy_snapshot,calculated_by,request_key
  ) values (
    p_org,p_prospect,v_prospect.converted_customer_id,v_policy.id,p_source_document_type,p_source_document_id,
    v_basis,v_policy.commission_rate,v_total,v_policy.currency,
    jsonb_build_object('policy_id',v_policy.id,'policy_name',v_policy.name,'calculation_basis',v_policy.calculation_basis,
      'commission_rate',v_policy.commission_rate,'fixed_basis_amount',v_policy.fixed_basis_amount,
      'expense_account_code',v_policy.expense_account_code,
      'effective_from',v_policy.effective_from,'effective_until',v_policy.effective_until,'rules',v_rule_snapshot),
    auth.uid(),p_request_key
  ) returning id into v_calculation;

  with contributors as (
    select c.id,c.user_id,c.contribution_type,r.share_percentage,
      count(*) over(partition by c.contribution_type) as role_count,
      (v_total * r.share_percentage / v_share_total
        / count(*) over(partition by c.contribution_type)) as raw_amount
    from public.prospect_contributors c
    join public.commission_policy_rules r on r.policy_id=v_policy.id
      and r.organization_id=p_org and r.contribution_type=c.contribution_type
    where c.organization_id=p_org and c.prospect_id=p_prospect
  ), ranked as (
    select *,
      floor(raw_amount * 100) / 100 as floor_amount,
      row_number() over(
        order by (raw_amount * 100 - floor(raw_amount * 100)) desc,
          contribution_type,user_id,id
      ) as remainder_rank,
      (v_total * 100 - sum(floor(raw_amount * 100)) over())::integer as remaining_cents
    from contributors
  ), allocated as (
    select *,
      floor_amount + case when remainder_rank <= remaining_cents then 0.01 else 0 end as final_amount
    from ranked
  )
  insert into public.commission_allocations(
    organization_id,calculation_id,user_id,contribution_type,share_percentage,amount
  )
  select p_org,v_calculation,user_id,contribution_type,
    (share_percentage / v_share_total * 100 / role_count),final_amount
  from allocated where final_amount > 0;

  perform public.audit_event(p_org,'commission.calculated','commission_calculations',v_calculation,null,
    jsonb_build_object('prospect_id',p_prospect,'basis_amount',v_basis,'commission_total',v_total,'currency',v_policy.currency));
  return v_calculation;
end;
$$;

create or replace function public.review_prospect_commission(
  p_org uuid,p_calculation uuid,p_decision text,p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.approve') then
    raise exception 'Validation réservée à la fonction finance.';
  end if;
  if p_decision not in ('approve','reject') then raise exception 'Décision invalide.'; end if;
  if p_decision='reject' and length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'Un motif de rejet détaillé est obligatoire.';
  end if;
  update public.commission_calculations
  set status=case when p_decision='approve' then 'approved' else 'rejected' end,
      approved_by=auth.uid(),approved_at=now(),
      rejection_reason=case when p_decision='reject' then trim(p_reason) else null end
  where id=p_calculation and organization_id=p_org and status='calculated';
  if not found then raise exception 'Prime introuvable ou déjà traitée.'; end if;
  perform public.audit_event(p_org,'commission.reviewed','commission_calculations',p_calculation,null,
    jsonb_build_object('decision',p_decision,'reason',p_reason));
end;
$$;

create or replace function public.record_commission_payment(
  p_org uuid,p_allocation uuid,p_account uuid,p_amount numeric,p_paid_at date,p_reference text,p_request_key uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation public.commission_allocations%rowtype;
  v_calculation public.commission_calculations%rowtype;
  v_existing public.commission_payments%rowtype;
  v_payment uuid;
  v_expense uuid;
  v_expense_account_code text;
  v_prospect_name text;
  v_digest text;
  v_paid_allocation numeric(18,2);
  v_paid_total numeric(18,2);
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.pay') then
    raise exception 'Enregistrement réservé à la fonction finance.';
  end if;
  if p_request_key is null then raise exception 'Clé d idempotence obligatoire.'; end if;
  if p_account is null or p_amount is null or p_amount<=0 or p_paid_at is null
     or length(trim(coalesce(p_reference,'')))<2 then
    raise exception 'Données de décaissement invalides.';
  end if;

  v_digest := md5(jsonb_build_array(p_org,p_allocation,p_account,p_amount,p_paid_at,trim(p_reference))::text);
  select * into v_existing from public.commission_payments
  where organization_id=p_org and request_key=p_request_key
  for update;
  if found then
    if v_existing.request_digest is distinct from v_digest then
      raise exception 'Clé de requête déjà utilisée pour un autre décaissement.';
    end if;
    return v_existing.id;
  end if;

  select a.* into v_allocation
  from public.commission_allocations a
  where a.id=p_allocation and a.organization_id=p_org for update;
  if not found then raise exception 'Attribution introuvable.'; end if;

  select c.* into v_calculation
  from public.commission_calculations c
  where c.id=v_allocation.calculation_id and c.organization_id=p_org
  for update;
  if not found or v_calculation.status not in ('approved','partially_paid') then
    raise exception 'Seules les primes validées par finance peuvent être payées.';
  end if;

  select coalesce(sum(amount),0) into v_paid_allocation
  from public.commission_payments
  where allocation_id=p_allocation and organization_id=p_org;
  if p_amount > v_allocation.amount-v_paid_allocation then
    raise exception 'Le paiement dépasse le solde de la prime.';
  end if;

  v_expense_account_code := v_calculation.policy_snapshot->>'expense_account_code';
  if not exists (
    select 1 from public.pcg2005_accounts
    where code=v_expense_account_code and kind='expense'
  ) then
    raise exception 'Le compte PCG de charge mémorisé dans la politique est invalide.';
  end if;

  select name into v_prospect_name
  from public.prospects
  where id=v_calculation.prospect_id and organization_id=p_org;
  if v_prospect_name is null then raise exception 'Prospect source introuvable.'; end if;

  v_expense := public.lot1_record_expense_v2_idempotent(
    p_org,
    'Commission commerciale - ' || v_prospect_name || ' - ' || v_allocation.contribution_type,
    p_amount,p_paid_at,p_account,v_expense_account_code,p_request_key,
    'expense',null,trim(p_reference),null,0,0,0,'none'
  );

  insert into public.commission_payments(
    organization_id,allocation_id,financial_account_id,expense_id,amount,paid_at,
    payment_reference,recorded_by,request_key,request_digest
  ) values (
    p_org,p_allocation,p_account,v_expense,p_amount,p_paid_at,
    trim(p_reference),auth.uid(),p_request_key,v_digest
  ) returning id into v_payment;

  select coalesce(sum(p.amount),0) into v_paid_total
  from public.commission_payments p
  join public.commission_allocations a
    on a.id=p.allocation_id and a.organization_id=p.organization_id
  where a.calculation_id=v_calculation.id and a.organization_id=p_org;

  update public.commission_calculations
  set status=case when v_paid_total >= v_calculation.commission_total then 'paid' else 'partially_paid' end
  where id=v_calculation.id and organization_id=p_org;

  perform public.audit_event(p_org,'commission.payment_recorded','commission_payments',v_payment,null,
    jsonb_build_object('allocation_id',p_allocation,'amount',p_amount,'paid_at',p_paid_at,
      'reference',trim(p_reference),'financial_account_id',p_account,'expense_id',v_expense));
  return v_payment;
end;
$$;


create or replace function public.create_prospect_with_originator(
  p_org uuid,p_name text,p_email text default null,p_phone text default null,
  p_source text default null,p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prospect uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas le droit de créer un prospect.';
  end if;
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Le nom du prospect est obligatoire.'; end if;
  insert into public.prospects(organization_id,name,email,phone,source,status,notes)
  values(p_org,trim(p_name),nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_source,'')),''),'new',nullif(trim(coalesce(p_notes,'')),'')) returning id into v_prospect;
  insert into public.prospect_contributors(
    organization_id,prospect_id,user_id,contribution_type,created_by
  ) values(p_org,v_prospect,auth.uid(),'originator',auth.uid());
  perform public.audit_event(p_org,'prospect.created','prospects',v_prospect,null,jsonb_build_object('name',trim(p_name),'source',p_source));
  return v_prospect;
end;
$$;

create or replace function public.convert_prospect_to_customer(
  p_org uuid,p_prospect uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prospect public.prospects%rowtype;
  v_existing_customer uuid;
  v_customer uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'prospects.convert') then
    raise exception 'Tu n''as pas l''autorisation de convertir ce prospect.';
  end if;
  select * into v_prospect from public.prospects
  where id=p_prospect and organization_id=p_org for update;
  if not found then raise exception 'Prospect introuvable.'; end if;
  if v_prospect.converted_customer_id is not null then
    return v_prospect.converted_customer_id;
  end if;
  if v_prospect.status='lost' then raise exception 'Un prospect perdu ne peut pas être converti.'; end if;

  if coalesce(trim(v_prospect.email),'')<>'' or coalesce(trim(v_prospect.phone),'')<>'' then
    select id into v_existing_customer from public.customers
    where organization_id=p_org and is_active and (
      (coalesce(trim(v_prospect.email),'')<>'' and lower(trim(coalesce(email,'')))=lower(trim(v_prospect.email)))
      or (coalesce(trim(v_prospect.phone),'')<>'' and
          regexp_replace(coalesce(phone,''),'[^0-9]','','g')=nullif(regexp_replace(v_prospect.phone,'[^0-9]','','g'),''))
    )
    limit 1;
    if v_existing_customer is not null then
      raise exception 'Un client actif possède déjà cet e-mail ou ce numéro. Vérifie le doublon avant conversion.';
    end if;
  end if;

  insert into public.customers(organization_id,name,email,phone,notes)
  values(p_org,trim(v_prospect.name),v_prospect.email,v_prospect.phone,v_prospect.notes)
  returning id into v_customer;

  update public.prospects
  set status='won',converted_customer_id=v_customer,updated_at=now()
  where id=p_prospect and organization_id=p_org;
  perform public.audit_event(p_org,'prospect.converted','prospects',p_prospect,
    jsonb_build_object('status',v_prospect.status,'converted_customer_id',v_prospect.converted_customer_id),
    jsonb_build_object('status','won','converted_customer_id',v_customer));

  return v_customer;
end;
$$;

create or replace function public.save_commission_policy(
  p_org uuid,p_policy uuid,p_name text,p_description text,p_active boolean,
  p_effective_from date,p_effective_until date,p_basis text,p_rate numeric,
  p_fixed_basis_amount numeric,p_currency text,p_expense_account_code text,p_rules jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy uuid;
  v_sum numeric;
  v_count integer;
  v_org_currency text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.policy.manage') then
    raise exception 'Gestion des politiques réservée aux responsables habilités.';
  end if;
  select currency into v_org_currency from public.organizations where id=p_org;
  if not found or v_org_currency is null then
    raise exception 'Devise de l''organisation introuvable.';
  end if;
  if p_currency is distinct from v_org_currency then
    raise exception 'La devise de la politique doit être celle de l''organisation (%).', v_org_currency;
  end if;
  if not exists (select 1 from public.pcg2005_accounts where code=p_expense_account_code and kind='expense') then
    raise exception 'Le compte PCG de charge des commissions est invalide.';
  end if;
  if length(trim(coalesce(p_name,'')))<2
     or p_basis not in ('order_total','invoice_paid_amount','fixed_amount')
     or p_rate<=0 or p_rate>100 or p_currency !~ '^[A-Z]{3}$'
     or p_effective_from is null
     or (p_effective_until is not null and p_effective_until<p_effective_from)
     or p_rules is null or jsonb_typeof(p_rules)<>'array' then
    raise exception 'Paramètres de politique invalides.';
  end if;
  if p_basis='fixed_amount' and coalesce(p_fixed_basis_amount,0)<=0 then
    raise exception 'Le montant de base fixe doit être positif.';
  end if;
  if p_basis<>'fixed_amount' and p_fixed_basis_amount is not null then
    raise exception 'Le montant fixe ne s''applique qu''à une base fixe.';
  end if;
  select count(*),coalesce(sum((x->>'share_percentage')::numeric),0)
    into v_count,v_sum from jsonb_array_elements(p_rules) x;
  if v_count=0 or v_count>4 or v_sum<>100 then
    raise exception 'Les pourcentages des rôles doivent totaliser exactement 100 %%.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rules) x
    where x->>'contribution_type' not in ('originator','qualifier','negotiator','closer')
       or coalesce((x->>'share_percentage')::numeric,0)<=0
       or (x->>'share_percentage')::numeric>100
  ) then raise exception 'Une règle de répartition est invalide.'; end if;
  if (select count(distinct x->>'contribution_type') from jsonb_array_elements(p_rules) x)<>v_count then
    raise exception 'Un rôle ne peut apparaître qu''une seule fois dans la politique.';
  end if;

  if p_active then
    update public.commission_policies
    set is_active=false,updated_at=now(),updated_by=auth.uid()
    where organization_id=p_org and is_active and id is distinct from p_policy;
  end if;
  if p_policy is null then
    insert into public.commission_policies(
      organization_id,name,description,is_active,effective_from,effective_until,
      calculation_basis,commission_rate,fixed_basis_amount,currency,expense_account_code,created_by,updated_by
    ) values (
      p_org,trim(p_name),nullif(trim(coalesce(p_description,'')),''),p_active,p_effective_from,p_effective_until,
      p_basis,p_rate,p_fixed_basis_amount,p_currency,p_expense_account_code,auth.uid(),auth.uid()
    ) returning id into v_policy;
  else
    update public.commission_policies set
      name=trim(p_name),description=nullif(trim(coalesce(p_description,'')),''),
      is_active=p_active,effective_from=p_effective_from,effective_until=p_effective_until,
      calculation_basis=p_basis,commission_rate=p_rate,fixed_basis_amount=p_fixed_basis_amount,
      currency=p_currency,expense_account_code=p_expense_account_code,updated_by=auth.uid(),updated_at=now()
    where id=p_policy and organization_id=p_org returning id into v_policy;
    if v_policy is null then raise exception 'Politique introuvable.'; end if;
  end if;
  delete from public.commission_policy_rules where policy_id=v_policy and organization_id=p_org;
  insert into public.commission_policy_rules(organization_id,policy_id,contribution_type,share_percentage)
  select p_org,v_policy,x->>'contribution_type',(x->>'share_percentage')::numeric
  from jsonb_array_elements(p_rules) x;
  perform public.audit_event(p_org,'commission_policy.saved','commission_policies',v_policy,null,
    jsonb_build_object('name',trim(p_name),'basis',p_basis,'rate',p_rate,'active',p_active,'rules',p_rules));
  return v_policy;
end;
$$;

revoke all on function public.convert_prospect_to_customer(uuid,uuid) from public, anon;
revoke all on function public.create_prospect_with_originator(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.save_commission_policy(uuid,uuid,text,text,boolean,date,date,text,numeric,numeric,text,text,jsonb) from public, anon;
revoke all on function public.calculate_prospect_commission(uuid,uuid,uuid,text,uuid,uuid) from public, anon;
revoke all on function public.review_prospect_commission(uuid,uuid,text,text) from public, anon;
revoke all on function public.record_commission_payment(uuid,uuid,uuid,numeric,date,text,uuid) from public, anon;
grant execute on function public.convert_prospect_to_customer(uuid,uuid) to authenticated;
grant execute on function public.create_prospect_with_originator(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.save_commission_policy(uuid,uuid,text,text,boolean,date,date,text,numeric,numeric,text,text,jsonb) to authenticated;
grant execute on function public.calculate_prospect_commission(uuid,uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.review_prospect_commission(uuid,uuid,text,text) to authenticated;
grant execute on function public.record_commission_payment(uuid,uuid,uuid,numeric,date,text,uuid) to authenticated;
