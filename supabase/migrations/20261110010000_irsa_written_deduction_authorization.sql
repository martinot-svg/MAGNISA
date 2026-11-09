-- Require a dated written employee notification before applying deductible
-- health and pension contributions to the IRSA taxable base.
-- Existing payslips remain immutable; new authorization is snapshotted per payslip.
BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorization_reference text,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized_from date,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized_to date;

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorization_reference text,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized_from date,
  ADD COLUMN IF NOT EXISTS irsa_deduction_authorized_to date;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='employees_irsa_deduction_authorization_check'
      AND conrelid='public.employees'::regclass
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_irsa_deduction_authorization_check
      CHECK (
        NOT irsa_deduction_authorized OR (
          nullif(trim(coalesce(irsa_deduction_authorization_reference,'')),'') IS NOT NULL
          AND irsa_deduction_authorized_from IS NOT NULL
          AND (irsa_deduction_authorized_to IS NULL
            OR irsa_deduction_authorized_to >= irsa_deduction_authorized_from)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='payslips_irsa_deduction_authorization_check'
      AND conrelid='public.payslips'::regclass
  ) THEN
    ALTER TABLE public.payslips
      ADD CONSTRAINT payslips_irsa_deduction_authorization_check
      CHECK (
        NOT irsa_deduction_authorized OR (
          nullif(trim(coalesce(irsa_deduction_authorization_reference,'')),'') IS NOT NULL
          AND irsa_deduction_authorized_from IS NOT NULL
          AND (irsa_deduction_authorized_to IS NULL
            OR irsa_deduction_authorized_to >= irsa_deduction_authorized_from)
        )
      );
  END IF;
END
$constraints$;

COMMENT ON COLUMN public.employees.irsa_deduction_authorized IS
  'Indicates that a written notification authorizing IRSA deductions has been received for this employee.';
COMMENT ON COLUMN public.employees.irsa_deduction_authorization_reference IS
  'Traceable reference to the employee written notification authorizing IRSA deductions; retain the supporting document in the employee file.';
COMMENT ON COLUMN public.payslips.irsa_deduction_authorized IS
  'Immutable per-payslip snapshot: the employee written notification covered the full payroll period.';
COMMENT ON COLUMN public.payslips.irsa_deduction_authorization_reference IS
  'Reference and validity dates of the written notification used for this payslip calculation.';

-- Provide exact expected and supplied payroll figures when the database rejects a payslip.
create or replace function public.payroll_compute_fmfp_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_rule public.payroll_rule_sets%rowtype;
  v_period date;
  v_period_start date;
  v_deduction_authorized boolean;
  v_deduction_reference text;
  v_deduction_from date;
  v_deduction_to date;
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

  v_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employee_rate,2);
  v_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employee_rate,2);

  select irsa_dependants,irsa_deduction_authorized,irsa_deduction_authorization_reference,
         irsa_deduction_authorized_from,irsa_deduction_authorized_to
    into v_dependants,v_deduction_authorized,v_deduction_reference,v_deduction_from,v_deduction_to
    from public.employees where id=new.employee_id and organization_id=new.organization_id;

  v_deduction_authorized:=coalesce(v_deduction_authorized,false)
    and nullif(trim(coalesce(v_deduction_reference,'')),'') is not null
    and v_deduction_from is not null
    and v_deduction_from<=v_period_start
    and (v_deduction_to is null or v_deduction_to>=v_period);
  new.irsa_deduction_authorized:=v_deduction_authorized;
  new.irsa_deduction_authorization_reference:=v_deduction_reference;
  new.irsa_deduction_authorized_from:=v_deduction_from;
  new.irsa_deduction_authorized_to:=v_deduction_to;

  v_deductible_health:=case when v_deduction_authorized
    then least(v_health,round(new.gross_pay*v_rule.irsa_health_deduction_rate,2)) else 0 end;
  v_deductible_pension:=case when coalesce(v_deduction_authorized,false)
    then least(v_social+coalesce(new.employee_supplementary_pension,0),
      round(new.gross_pay*v_rule.irsa_pension_deduction_rate,2)) else 0 end;
  v_emp_social:=round(least(new.gross_pay,v_rule.cnaps_monthly_ceiling)*v_rule.cnaps_employer_rate,2);
  v_emp_health:=round(least(new.gross_pay,v_rule.health_monthly_ceiling)*v_rule.health_employer_rate,2);

  -- New bulletins use the amount computed by the effective-dated component classifier.
  -- Historical/direct RPC inserts without a classified amount retain the previous gross-base behavior.
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

  if v_dependants is null or v_dependants<0 or v_dependants>30 then
    raise exception 'Nombre de personnes à charge IRSA invalide';
  end if;
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
  return new;
end
$function$;




NOTIFY pgrst,'reload schema';
COMMIT;
