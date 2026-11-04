begin;

alter table public.loans
  add column if not exists interest_type text not null default 'simple'
  check (interest_type in ('simple','compound'));

alter table public.loan_schedule_versions
  add column if not exists financial_terms jsonb not null default '{}'::jsonb;

-- Freeze the financial terms on historical versions using the values already stored on each loan.
update public.loan_schedule_versions v
set financial_terms = jsonb_build_object(
  'principal', l.principal,
  'annual_rate_percent', l.interest_rate,
  'interest_type', coalesce(l.interest_type, 'simple'),
  'interest_calculation_method', coalesce(l.interest_calculation_method, 'outstanding_balance'),
  'repayment_method', coalesce(l.repayment_method, 'annuity'),
  'payments_per_year', coalesce(l.payment_frequency, 12),
  'installment_count', coalesce(l.total_installments, 0),
  'first_due_date', l.first_due_date,
  'rate_basis', case when coalesce(l.interest_type, 'simple') = 'compound' then 'effective_annual' else 'nominal_annual' end
)
from public.loans l
where l.id = v.loan_id and v.status = 'active' and v.financial_terms = '{}'::jsonb;

-- Permit exactly one write of a previously empty snapshot. All subsequent changes remain blocked.
create or replace function public.guard_loan_schedule_version_history()
returns trigger language plpgsql set search_path=public
as $function$
begin
  if tg_op='DELETE' then
    raise exception 'Une version d’échéancier historique ne peut pas être supprimée.';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.loan_id is distinct from old.loan_id
     or new.version_number is distinct from old.version_number
     or new.version_type is distinct from old.version_type
     or new.effective_from is distinct from old.effective_from
     or new.amendment_reference is distinct from old.amendment_reference
     or new.amendment_reason is distinct from old.amendment_reason
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Les données contractuelles d’une version sont immuables.';
  end if;
  if new.financial_terms is distinct from old.financial_terms then
    if old.financial_terms <> '{}'::jsonb or new.financial_terms = '{}'::jsonb then
      raise exception 'Les conditions financières d’une version sont immuables après leur premier enregistrement.';
    end if;
    return new;
  end if;
  if new.status not in ('superseded','cancelled') or old.status <> 'active' then
    raise exception 'Seule la désactivation d’une version active est autorisée.';
  end if;
  return new;
end;
$function$;

create or replace function public.set_loan_schedule_version_terms(
  p_organization_id uuid,
  p_loan_id uuid,
  p_version_id uuid,
  p_financial_terms jsonb
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $function$
declare
  v_version public.loan_schedule_versions%rowtype;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id,'accounting.manage');
  if jsonb_typeof(p_financial_terms) <> 'object'
     or p_financial_terms->>'interest_type' not in ('simple','compound')
     or p_financial_terms->>'interest_calculation_method' not in ('outstanding_balance','original_principal')
     or p_financial_terms->>'repayment_method' not in ('annuity','equal_principal','bullet')
     or (p_financial_terms->>'annual_rate_percent')::numeric < 0
     or (p_financial_terms->>'annual_rate_percent')::numeric > 1000
     or (p_financial_terms->>'payments_per_year')::integer not in (1,2,3,4,6,12)
     or (p_financial_terms->>'installment_count')::integer < 1
  then
    raise exception 'Instantané des conditions financières invalide';
  end if;
  select * into v_version
  from public.loan_schedule_versions
  where id=p_version_id and loan_id=p_loan_id and organization_id=p_organization_id
    and status='active'
  for update;
  if not found then raise exception 'Version active introuvable'; end if;
  if v_version.financial_terms <> '{}'::jsonb then
    raise exception 'Les conditions financières de cette version sont déjà figées';
  end if;
  update public.loan_schedule_versions
  set financial_terms=p_financial_terms
  where id=p_version_id;
end;
$function$;

revoke all on function public.set_loan_schedule_version_terms(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.set_loan_schedule_version_terms(uuid,uuid,uuid,jsonb) to authenticated;

-- Atomic amendment wrapper: create the schedule, update current loan terms and freeze the matching snapshot.
create or replace function public.create_loan_schedule_amendment_with_terms(
  p_organization_id uuid,
  p_loan_id uuid,
  p_effective_from date,
  p_amendment_reference text,
  p_amendment_reason text,
  p_installments jsonb,
  p_financial_terms jsonb
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $function$
declare
  v_version_id uuid;
begin
  perform public.assert_org_access(p_organization_id);
  perform public.assert_org_permission(p_organization_id,'accounting.manage');
  v_version_id := public.create_loan_schedule_amendment(
    p_organization_id,p_loan_id,p_effective_from,
    p_amendment_reference,p_amendment_reason,p_installments
  );
  update public.loans
  set interest_rate=(p_financial_terms->>'annual_rate_percent')::numeric,
      interest_type=p_financial_terms->>'interest_type',
      interest_calculation_method=p_financial_terms->>'interest_calculation_method',
      repayment_method=p_financial_terms->>'repayment_method',
      payment_frequency=(p_financial_terms->>'payments_per_year')::integer,
      total_installments=(p_financial_terms->>'installment_count')::integer,
      first_due_date=(p_financial_terms->>'first_due_date')::date
  where id=p_loan_id and organization_id=p_organization_id;
  perform public.set_loan_schedule_version_terms(
    p_organization_id,p_loan_id,v_version_id,p_financial_terms
  );
  return v_version_id;
end;
$function$;

revoke all on function public.create_loan_schedule_amendment_with_terms(uuid,uuid,date,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.create_loan_schedule_amendment_with_terms(uuid,uuid,date,text,text,jsonb,jsonb) to authenticated;

commit;
