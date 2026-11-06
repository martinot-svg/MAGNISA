-- Align the database-side payroll trigger with the IRSA deduction limit.
-- CGI Madagascar, article 01.03.09, 2°: employee contributions to a
-- workplace medical service / health insurance are deductible up to 1%
-- of gross salary. The actual SMIE withholding remains unchanged.
-- Existing payslips are not recalculated by this migration.

begin;

create or replace function public.payroll_compute_fmfp_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rule public.payroll_rule_sets%rowtype;
  v_period date;
  v_count integer;
  v_social numeric;
  v_health numeric;
  v_deductible_health numeric;
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

  if v_rule.cnaps_monthly_ceiling is null
    or v_rule.health_monthly_ceiling is null
    or v_rule.rounding_policy <> 'floor_100'
    or jsonb_typeof(v_rule.irsa_brackets) <> 'array'
    or jsonb_array_length(v_rule.irsa_brackets) = 0 then
    raise exception 'Référentiel fiscal ou social incomplet';
  end if;

  v_social := round(least(new.gross_pay, v_rule.cnaps_monthly_ceiling) * v_rule.cnaps_employee_rate, 2);
  v_health := round(least(new.gross_pay, v_rule.health_monthly_ceiling) * v_rule.health_employee_rate, 2);
  v_deductible_health := least(v_health, round(new.gross_pay * 0.01, 2));
  v_emp_social := round(least(new.gross_pay, v_rule.cnaps_monthly_ceiling) * v_rule.cnaps_employer_rate, 2);
  v_emp_health := round(least(new.gross_pay, v_rule.health_monthly_ceiling) * v_rule.health_employer_rate, 2);

  v_taxable := floor(greatest(0, new.gross_pay - v_social - v_deductible_health) / 100) * 100;

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

  if v_taxable > 350000 and v_dependants > 0 then
    v_tax := greatest(coalesce(v_rule.irsa_minimum, 0), v_tax - 2000 * v_dependants);
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

revoke all on function public.payroll_compute_fmfp_on_insert() from public, anon, authenticated;

commit;
