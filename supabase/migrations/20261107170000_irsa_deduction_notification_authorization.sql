-- CGI Madagascar, article 01.03.11: deductions under article 01.03.09 require written notification.
-- Preserve the existing classified-compensation and supplementary-pension calculation.
begin;

alter table public.employees
  add column if not exists irsa_deduction_authorized boolean not null default false,
  add column if not exists irsa_deduction_authorization_reference text,
  add column if not exists irsa_deduction_authorized_from date,
  add column if not exists irsa_deduction_authorized_to date;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.employees'::regclass
      and conname='employees_irsa_deduction_authorization_reference_required'
  ) then
    alter table public.employees
      add constraint employees_irsa_deduction_authorization_reference_required
      check (
        not irsa_deduction_authorized
        or nullif(btrim(irsa_deduction_authorization_reference),'') is not null
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.employees'::regclass
      and conname='employees_irsa_deduction_authorization_dates_valid'
  ) then
    alter table public.employees
      add constraint employees_irsa_deduction_authorization_dates_valid
      check (
        irsa_deduction_authorized_to is null
        or irsa_deduction_authorized_from is null
        or irsa_deduction_authorized_to>=irsa_deduction_authorized_from
      );
  end if;
end
$constraints$;

create or replace function public.payroll_compute_fmfp_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_rule public.payroll_rule_sets%rowtype;
  v_period_start date;
  v_period date;
  v_count integer;
  v_social numeric;
  v_health numeric;
  v_deductible_health numeric;
  v_deductible_pension numeric;
  v_emp_social numeric;
  v_emp_health numeric;
  v_taxable numeric;
  v_tax numeric := 0;
  v_previous numeric := 0;
  v_upper numeric;
  v_rate numeric;
  v_b jsonb;
  v_dependants integer;
  v_employee_authorized boolean;
  v_authorization_reference text;
  v_authorized_from date;
  v_authorized_to date;
  v_irsa_deduction_authorized boolean := false;
begin
  select period_start,period_end into v_period_start,v_period from public.payroll_runs
   where id=new.payroll_run_id and organization_id=new.organization_id;
  if v_period is null then raise exception 'Période de paie introuvable'; end if;

  select count(*) into v_count from public.payroll_rule_sets
   where organization_id=new.organization_id and status='validated'
     and effective_from<=v_period and (effective_to is null or effective_to>=v_period);
  if v_count<>1 then raise exception 'Référentiel réglementaire unique validé requis'; end if;

  select * into v_rule from public.payroll_rule_sets
   where organization_id=new.organization_id and status='validated'
     and effective_from<=v_period and (effective_to is null or effective_to>=v_period);

  if v_rule.irsa_dependant_reduction is null or v_rule.irsa_dependant_reduction<0
    or v_rule.irsa_dependant_threshold is null or v_rule.irsa_dependant_threshold<0
    or v_rule.irsa_health_deduction_rate is null or v_rule.irsa_health_deduction_rate<0
    or v_rule.irsa_health_deduction_rate>0.02
    or v_rule.irsa_pension_deduction_rate is null or v_rule.irsa_pension_deduction_rate<0
    or v_rule.irsa_pension_deduction_rate>0.10
    or v_rule.cnaps_monthly_ceiling is null or v_rule.health_monthly_ceiling is null
    or v_rule.rounding_policy<>'floor_100'
    or jsonb_typeof(v_rule.irsa_brackets)<>'array'
    or jsonb_array_length(v_rule.irsa_brackets)=0 then
    raise exception 'Référentiel fiscal ou social incomplet';
  end if;

  select irsa_dependants,coalesce(irsa_deduction_authorized,false),
         irsa_deduction_authorization_reference,irsa_deduction_authorized_from,irsa_deduction_authorized_to
    into v_dependants,v_employee_authorized,v_authorization_reference,v_authorized_from,v_authorized_to
    from public.employees
   where id=new.employee_id and organization_id=new.organization_id;
  if v_dependants is null or v_dependants<0 or v_dependants>30 then
    raise exception 'Nombre de personnes à charge IRSA invalide';
  end if;
  v_irsa_deduction_authorized := v_employee_authorized
    and nullif(btrim(v_authorization_reference),'') is not null
    and (v_authorized_from is null or v_authorized_from<=v_period_start)
    and (v_authorized_to is null or v_authorized_to>=v_period);

  v_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employee_rate,2);
  v_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employee_rate,2);
  v_deductible_health:=case when v_irsa_deduction_authorized
    then least(v_health,round(new.gross_pay*v_rule.irsa_health_deduction_rate,2)) else 0 end;
  v_deductible_pension:=case when v_irsa_deduction_authorized
    then least(v_social+coalesce(new.employee_supplementary_pension,0),
      round(new.gross_pay*v_rule.irsa_pension_deduction_rate,2)) else 0 end;
  v_emp_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employer_rate,2);
  v_emp_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employer_rate,2);

  -- New bulletins use the amount computed by the effective-dated component classifier.
  -- Historical/direct RPC inserts without the new field retain the previous gross-base behavior.
  v_taxable:=floor(greatest(0,coalesce(new.taxable_compensation,new.gross_pay)
    +coalesce(new.taxable_supplementary_pension,0)-v_deductible_pension-v_deductible_health)/100)*100;

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
  if v_taxable=0 then v_tax:=0;
  else v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),round(v_tax,2)); end if;

  if v_taxable>v_rule.irsa_dependant_threshold and v_dependants>0 then
    v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),v_tax-v_rule.irsa_dependant_reduction*v_dependants);
  end if;

  if abs(new.employee_social-v_social)>.01 or abs(new.employee_health-v_health)>.01
    or abs(new.employer_social-v_emp_social)>.01 or abs(new.employer_health-v_emp_health)>.01
    or abs(new.income_tax-v_tax)>.01 then
    raise exception 'Retenues incohérentes avec le référentiel : social salarié attendu %, reçu % ; santé salarié attendu %, reçu % ; social employeur attendu %, reçu % ; santé employeur attendu %, reçu % ; IRSA attendu %, reçu % ; assiette IRSA %',
      v_social,new.employee_social,v_health,new.employee_health,v_emp_social,new.employer_social,
      v_emp_health,new.employer_health,v_tax,new.income_tax,v_taxable;
  end if;
  new.employer_fmfp:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.fmfp_employer_rate,2);
  new.fiscal_snapshot:=coalesce(new.fiscal_snapshot,'{}'::jsonb);
  new.fiscal_snapshot:=jsonb_set(new.fiscal_snapshot,'{irsaDeductionAuthorization}',jsonb_build_object(
    'authorized',v_irsa_deduction_authorized,
    'reference',case when v_irsa_deduction_authorized then v_authorization_reference else null end,
    'validFrom',v_authorized_from,
    'validTo',v_authorized_to,
    'legalReference','CGI Madagascar, article 01.03.11'
  ),true);
  new.fiscal_snapshot:=jsonb_set(new.fiscal_snapshot,'{calculation}',
    coalesce(new.fiscal_snapshot->'calculation','{}'::jsonb) || jsonb_build_object(
      'irsaDeductionAuthorized',v_irsa_deduction_authorized,
      'deductibleHealth',v_deductible_health,
      'deductiblePension',v_deductible_pension,
      'taxableBase',v_taxable
    ),true);
  return new;
end
$function$;

revoke all on function public.payroll_compute_fmfp_on_insert() from public,anon,authenticated;

comment on column public.employees.irsa_deduction_authorized is
  'Indique si une notification écrite du service fiscal autorise les déductions IRSA de l’article 01.03.09.';
comment on column public.employees.irsa_deduction_authorization_reference is
  'Référence vérifiable de la notification écrite du service fiscal.';
comment on column public.employees.irsa_deduction_authorized_from is
  'Date de début de validité de la notification écrite IRSA.';
comment on column public.employees.irsa_deduction_authorized_to is
  'Date de fin de validité de la notification écrite IRSA.';

commit;
