-- Reconstructed parity migration: SMIE metadata and FMFP payroll ledger support.
-- Column types, defaults, constraints, and trigger behavior were recovered from
-- production catalog definitions. Apply to test only until payroll QA is signed off.
begin;

alter table public.organizations
  add column if not exists smie_partner_name text;
alter table public.payroll_rule_sets
  add column if not exists smie_partner_name text,
  add column if not exists smie_partner_contact text,
  add column if not exists smie_affiliation_number text,
  add column if not exists smie_contract_reference text;
alter table public.payslips
  add column if not exists employer_fmfp numeric not null default 0;

do $migration$
begin
  if not exists (select 1 from pg_constraint where conname='organization_smie_partner_name_limit' and conrelid='public.organizations'::regclass) then
    alter table public.organizations add constraint organization_smie_partner_name_limit
      check (length(coalesce(smie_partner_name,'')) <= 160);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_smie_partner_lengths' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_smie_partner_lengths
      check (
        length(coalesce(smie_partner_name,'')) <= 160 and
        length(coalesce(smie_partner_contact,'')) <= 500 and
        length(coalesce(smie_affiliation_number,'')) <= 120 and
        length(coalesce(smie_contract_reference,'')) <= 200
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='payslip_fmfp_nonnegative' and conrelid='public.payslips'::regclass) then
    alter table public.payslips add constraint payslip_fmfp_nonnegative check (employer_fmfp >= 0);
  end if;
end
$migration$;

create or replace function public.payroll_compute_fmfp_on_insert()
returns trigger language plpgsql security definer set search_path = public
as $function$
declare
  v_rule public.payroll_rule_sets%rowtype;
  v_period date;
  v_count integer;
  v_social numeric;
  v_health numeric;
  v_emp_social numeric;
  v_emp_health numeric;
  v_taxable numeric;
  v_tax numeric := 0;
  v_previous numeric := 0;
  v_upper numeric;
  v_rate numeric;
  v_b jsonb;
  v_dependants integer;
begin
  select period_end into v_period from public.payroll_runs
    where id=new.payroll_run_id and organization_id=new.organization_id;
  if v_period is null then raise exception 'Période de paie introuvable'; end if;
  select count(*) into v_count from public.payroll_rule_sets
    where organization_id=new.organization_id and status='validated'
      and effective_from<=v_period and (effective_to is null or effective_to>=v_period);
  if v_count<>1 then raise exception 'Référentiel réglementaire unique validé requis'; end if;
  select * into v_rule from public.payroll_rule_sets
    where organization_id=new.organization_id and status='validated'
      and effective_from<=v_period and (effective_to is null or effective_to>=v_period);
  if v_rule.cnaps_monthly_ceiling is null or v_rule.health_monthly_ceiling is null
    or v_rule.rounding_policy<>'floor_100' or jsonb_typeof(v_rule.irsa_brackets)<>'array'
    or jsonb_array_length(v_rule.irsa_brackets)=0 then
    raise exception 'Référentiel fiscal ou social incomplet';
  end if;
  v_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employee_rate,2);
  v_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employee_rate,2);
  v_emp_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employer_rate,2);
  v_emp_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employer_rate,2);
  v_taxable:=floor(greatest(0,new.gross_pay-v_social-v_health)/100)*100;
  for v_b in select value from jsonb_array_elements(v_rule.irsa_brackets) loop
    v_rate:=(v_b->>'rate')::numeric;
    v_upper:=case when v_b->>'up_to' is null then null else (v_b->>'up_to')::numeric end;
    if v_rate is null or v_rate<0 or v_rate>1 or (v_upper is not null and v_upper<=v_previous) then
      raise exception 'Barème IRSA invalide';
    end if;
    if v_upper is null then
      v_tax:=v_tax+greatest(0,v_taxable-v_previous)*v_rate;
      v_previous:=v_taxable;
      exit;
    end if;
    v_tax:=v_tax+greatest(0,least(v_taxable,v_upper)-v_previous)*v_rate;
    v_previous:=v_upper;
    if v_taxable<=v_upper then exit; end if;
  end loop;
  if v_previous<v_taxable then raise exception 'Barème IRSA sans tranche couvrant le revenu imposable'; end if;
  v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),round(v_tax,2));
  select irsa_dependants into v_dependants from public.employees
    where id=new.employee_id and organization_id=new.organization_id;
  if v_dependants is null or v_dependants<0 or v_dependants>30 then
    raise exception 'Nombre de personnes à charge IRSA invalide';
  end if;
  if v_taxable>350000 and v_dependants>0 then
    v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),v_tax-2000*v_dependants);
  end if;
  if abs(new.employee_social-v_social)>.01 or abs(new.employee_health-v_health)>.01
    or abs(new.employer_social-v_emp_social)>.01 or abs(new.employer_health-v_emp_health)>.01
    or abs(new.income_tax-v_tax)>.01 then
    raise exception 'Retenues et charges incohérentes avec le référentiel fiscal validé';
  end if;
  new.employer_fmfp:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.fmfp_employer_rate,2);
  return new;
end
$function$;

create or replace function public.payroll_fmfp_debit_line()
returns trigger language plpgsql security definer set search_path = public
as $function$
begin
  if new.account_key='FMFP_PAYABLE' and new.credit>0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values(new.organization_id,new.journal_entry_id,'PAYROLL_EXPENSE:FMFP','Charge patronale FMFP',new.credit,0);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_payroll_compute_fmfp_on_insert on public.payslips;
create trigger trg_payroll_compute_fmfp_on_insert
  before insert on public.payslips
  for each row execute function public.payroll_compute_fmfp_on_insert();
drop trigger if exists trg_fmfp_debit_line on public.journal_entry_lines;
create trigger trg_fmfp_debit_line
  after insert on public.journal_entry_lines
  for each row when (new.account_key='FMFP_PAYABLE')
  execute function public.payroll_fmfp_debit_line();

revoke all on function public.payroll_compute_fmfp_on_insert() from public, anon, authenticated;
revoke all on function public.payroll_fmfp_debit_line() from public, anon, authenticated;
commit;
