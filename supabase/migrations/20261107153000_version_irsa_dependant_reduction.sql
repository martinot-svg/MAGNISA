-- Version the IRSA dependant reduction and eligibility threshold per effective-dated payroll rule set.
begin;
alter table public.payroll_rule_sets
  add column if not exists irsa_dependant_reduction numeric(18,2) not null default 2000,
  add column if not exists irsa_dependant_threshold numeric(18,2) not null default 350000,
  add column if not exists irsa_pension_deduction_rate numeric(9,6) not null default 0.10;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_dependant_reduction_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_dependant_reduction_check check (irsa_dependant_reduction >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_dependant_threshold_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_dependant_threshold_check check (irsa_dependant_threshold >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_pension_deduction_rate_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_pension_deduction_rate_check check (irsa_pension_deduction_rate >= 0 and irsa_pension_deduction_rate <= 1);
  end if;
end $;

create or replace function public.payroll_compute_fmfp_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_rule public.payroll_rule_sets%rowtype;
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
begin
  select period_end into v_period
  from public.payroll_runs
  where id = new.payroll_run_id
    and organization_id = new.organization_id;

  if v_period is null then
    raise exception 'Période de paie introuvable';
  end if;

  select count(*) into v_count
  from public.payroll_rule_sets
  where organization_id = new.organization_id
    and status = 'validated'
    and effective_from <= v_period
    and (effective_to is null or effective_to >= v_period);

  if v_count <> 1 then
    raise exception 'Référentiel réglementaire unique validé requis';
  end if;

  select * into v_rule
  from public.payroll_rule_sets
  where organization_id = new.organization_id
    and status = 'validated'
    and effective_from <= v_period
    and (effective_to is null or effective_to >= v_period);

  if v_rule.irsa_dependant_reduction is null or v_rule.irsa_dependant_reduction < 0
    or v_rule.irsa_dependant_threshold is null or v_rule.irsa_dependant_threshold < 0
    or v_rule.irsa_health_deduction_rate is null
    or v_rule.irsa_health_deduction_rate < 0
    or v_rule.irsa_health_deduction_rate > 1
    or v_rule.irsa_pension_deduction_rate is null
    or v_rule.irsa_pension_deduction_rate < 0
    or v_rule.irsa_pension_deduction_rate > 1
    or v_rule.cnaps_monthly_ceiling is null
    or v_rule.health_monthly_ceiling is null
    or v_rule.rounding_policy <> 'floor_100'
    or jsonb_typeof(v_rule.irsa_brackets) <> 'array'
    or jsonb_array_length(v_rule.irsa_brackets) = 0 then
    raise exception 'Référentiel fiscal ou social incomplet';
  end if;

  v_social := round(least(new.gross_pay, v_rule.cnaps_monthly_ceiling) * v_rule.cnaps_employee_rate, 2);
  v_health := round(least(new.gross_pay, v_rule.health_monthly_ceiling) * v_rule.health_employee_rate, 2);
  v_deductible_health := least(v_health, round(new.gross_pay * v_rule.irsa_health_deduction_rate, 2));
  v_deductible_pension := least(v_social, round(new.gross_pay * v_rule.irsa_pension_deduction_rate, 2));
  v_emp_social := round(least(new.gross_pay, v_rule.cnaps_monthly_ceiling) * v_rule.cnaps_employer_rate, 2);
  v_emp_health := round(least(new.gross_pay, v_rule.health_monthly_ceiling) * v_rule.health_employer_rate, 2);

  -- Employer-funded supplementary pension is taxable for IRSA but is not part of gross cash pay.
  v_taxable := floor(greatest(0, new.gross_pay + coalesce(new.taxable_supplementary_pension, 0) - v_deductible_pension - v_deductible_health) / 100) * 100;

  for v_b in select value from jsonb_array_elements(v_rule.irsa_brackets) loop
    v_rate := (v_b->>'rate')::numeric;
    v_upper := case when v_b->>'up_to' is null then null else (v_b->>'up_to')::numeric end;

    if v_rate is null or v_rate < 0 or v_rate > 1
      or (v_upper is not null and v_upper <= v_previous) then
      raise exception 'Barème IRSA invalide';
    end if;

    if v_upper is null then
      v_tax := v_tax + greatest(0, v_taxable - v_previous) * v_rate;
      v_previous := v_taxable;
      exit;
    end if;

    v_tax := v_tax + greatest(0, least(v_taxable, v_upper) - v_previous) * v_rate;
    v_previous := v_upper;
    if v_taxable <= v_upper then
      exit;
    end if;
  end loop;

  if v_previous < v_taxable then
    raise exception 'Barème IRSA sans tranche couvrant le revenu imposable';
  end if;

  if v_taxable = 0 then
    v_tax := 0;
  else
    v_tax := greatest(coalesce(v_rule.irsa_minimum, 0), round(v_tax, 2));
  end if;

  select irsa_dependants into v_dependants
  from public.employees
  where id = new.employee_id
    and organization_id = new.organization_id;

  if v_dependants is null or v_dependants < 0 or v_dependants > 30 then
    raise exception 'Nombre de personnes à charge IRSA invalide';
  end if;

  if v_taxable > v_rule.irsa_dependant_threshold and v_dependants > 0 then
    v_tax := greatest(coalesce(v_rule.irsa_minimum, 0), v_tax - v_rule.irsa_dependant_reduction * v_dependants);
  end if;

  if abs(new.employee_social - v_social) > .01
    or abs(new.employee_health - v_health) > .01
    or abs(new.employer_social - v_emp_social) > .01
    or abs(new.employer_health - v_emp_health) > .01
    or abs(new.income_tax - v_tax) > .01 then
    raise exception 'Retenues et charges incohérentes avec le référentiel fiscal validé';
  end if;

  new.employer_fmfp := round(least(new.gross_pay, v_rule.cnaps_monthly_ceiling) * v_rule.fmfp_employer_rate, 2);
  return new;
end
$function$;



create or replace function public.audit_payroll_rule_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
 if tg_op='INSERT' then
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,new_values)
   values(new.organization_id,new.id,'created',auth.uid(),to_jsonb(new));
   return new;
 elsif tg_op='UPDATE' then
   if old.status in ('validated','archived') and (
     old.cnaps_employee_rate is distinct from new.cnaps_employee_rate or
     old.cnaps_employer_rate is distinct from new.cnaps_employer_rate or
     old.health_employee_rate is distinct from new.health_employee_rate or
     old.health_employer_rate is distinct from new.health_employer_rate or
     old.fmfp_employer_rate is distinct from new.fmfp_employer_rate or
     old.cnaps_monthly_ceiling is distinct from new.cnaps_monthly_ceiling or
     old.health_monthly_ceiling is distinct from new.health_monthly_ceiling or
     old.irsa_brackets is distinct from new.irsa_brackets or
     old.irsa_minimum is distinct from new.irsa_minimum or
     old.irsa_dependant_reduction is distinct from new.irsa_dependant_reduction or
     old.irsa_dependant_threshold is distinct from new.irsa_dependant_threshold or
     old.irsa_pension_deduction_rate is distinct from new.irsa_pension_deduction_rate or
     old.rounding_policy is distinct from new.rounding_policy or
     old.effective_from is distinct from new.effective_from)
   then raise exception 'Règle de paie validée immuable : créer une nouvelle version'; end if;
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values,new_values)
   values(new.organization_id,new.id,'updated',auth.uid(),to_jsonb(old),to_jsonb(new));
   return new;
 elsif tg_op='DELETE' then
   if old.status in ('validated','archived') then raise exception 'Suppression interdite pour une version validée ou archivée'; end if;
   insert into public.payroll_rule_change_log(organization_id,rule_id,action,actor_id,old_values)
   values(old.organization_id,old.id,'deleted',auth.uid(),to_jsonb(old));
   return old;
 end if;
 return null;
end $function$;

revoke all on function public.payroll_compute_fmfp_on_insert() from public, anon, authenticated;
commit;
