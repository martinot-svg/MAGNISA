-- Make classified IRSA base and fiscal evidence atomic with payslip creation.
begin;

alter table public.payslips
  add column if not exists taxable_compensation numeric(18,2),
  add column if not exists fiscal_snapshot jsonb,
  add column if not exists overtime_details jsonb;

alter table public.payroll_rule_sets
  add column if not exists irsa_compensation_rules jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='payroll_rule_compensation_rules_array'
      and conrelid='public.payroll_rule_sets'::regclass
  ) then
    alter table public.payroll_rule_sets
      add constraint payroll_rule_compensation_rules_array
      check (jsonb_typeof(irsa_compensation_rules)='array');
  end if;
end $$;

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
  v_deductible_health:=least(v_health,round(new.gross_pay*v_rule.irsa_health_deduction_rate,2));
  v_deductible_pension:=least(v_social+coalesce(new.employee_supplementary_pension,0),
    round(new.gross_pay*v_rule.irsa_pension_deduction_rate,2));
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

  select irsa_dependants into v_dependants from public.employees
   where id=new.employee_id and organization_id=new.organization_id;
  if v_dependants is null or v_dependants<0 or v_dependants>30 then
    raise exception 'Nombre de personnes à charge IRSA invalide';
  end if;
  if v_taxable>v_rule.irsa_dependant_threshold and v_dependants>0 then
    v_tax:=greatest(coalesce(v_rule.irsa_minimum,0),v_tax-v_rule.irsa_dependant_reduction*v_dependants);
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

-- New overload: the validated calculation and its evidence are written in one transaction.
create or replace function public.create_payslip(
  p_org uuid, p_run uuid, p_employee uuid,
  p_bonuses numeric, p_overtime numeric, p_other_earnings numeric,
  p_employee_social numeric, p_employee_health numeric, p_income_tax numeric,
  p_advances_recovered numeric, p_other_deductions numeric,
  p_employer_social numeric, p_employer_health numeric,
  p_taxable_supplementary_pension numeric, p_employee_supplementary_pension numeric,
  p_taxable_compensation numeric, p_fiscal_snapshot jsonb
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare
  v_employee public.employees%rowtype;
  v_run public.payroll_runs%rowtype;
  v_id uuid;
  v_gross numeric;
  v_net numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'payroll.manage');
  if p_fiscal_snapshot is null or jsonb_typeof(p_fiscal_snapshot)<>'object'
    or coalesce((p_fiscal_snapshot->>'schemaVersion')::integer,0)<1 then
    raise exception 'Snapshot fiscal manquant ou invalide';
  end if;
  if p_taxable_compensation is null or p_taxable_compensation<0
    or p_taxable_compensation>coalesce(p_bonuses,0)+coalesce(p_overtime,0)+coalesce(p_other_earnings,0)+coalesce((select base_salary from public.employees where id=p_employee and organization_id=p_org),0)+0.01 then
    raise exception 'Assiette imposable classifiée invalide';
  end if;
  if least(coalesce(p_bonuses,0),coalesce(p_overtime,0),coalesce(p_other_earnings,0),
    coalesce(p_employee_social,0),coalesce(p_employee_health,0),coalesce(p_income_tax,0),
    coalesce(p_advances_recovered,0),coalesce(p_other_deductions,0),coalesce(p_employer_social,0),
    coalesce(p_employer_health,0),coalesce(p_taxable_supplementary_pension,0),
    coalesce(p_employee_supplementary_pension,0))<0 then
    raise exception 'Les éléments de paie ne peuvent pas être négatifs';
  end if;

  select * into v_employee from public.employees
   where id=p_employee and organization_id=p_org and status='active';
  if not found then raise exception 'Salarié introuvable ou inactif'; end if;
  select * into v_run from public.payroll_runs
   where id=p_run and organization_id=p_org for update;
  if not found then raise exception 'Période de paie introuvable'; end if;
  if v_run.status not in ('draft','calculated','review') then
    raise exception 'Cette période de paie n''est plus modifiable';
  end if;
  if exists(select 1 from public.payslips where organization_id=p_org
    and payroll_run_id=p_run and employee_id=p_employee and status<>'cancelled') then
    raise exception 'Un bulletin existe déjà pour ce salarié sur cette période';
  end if;

  v_gross:=round(coalesce(v_employee.base_salary,0)+coalesce(p_bonuses,0)
    +coalesce(p_overtime,0)+coalesce(p_other_earnings,0),2);
  v_net:=round(v_gross-coalesce(p_employee_social,0)-coalesce(p_employee_health,0)
    -coalesce(p_income_tax,0)-coalesce(p_employee_supplementary_pension,0)
    -coalesce(p_advances_recovered,0)-coalesce(p_other_deductions,0),2);
  if v_net<0 then raise exception 'Le net à payer ne peut pas être négatif'; end if;

  insert into public.payslips(
    organization_id,payroll_run_id,employee_id,base_salary,bonuses,overtime,other_earnings,
    taxable_supplementary_pension,employee_supplementary_pension,taxable_compensation,
    fiscal_snapshot,overtime_details,employee_social,employee_health,income_tax,
    advances_recovered,other_deductions,employer_social,employer_health,gross_pay,net_pay,paid_amount,status
  ) values (
    p_org,p_run,p_employee,v_employee.base_salary,coalesce(p_bonuses,0),coalesce(p_overtime,0),
    coalesce(p_other_earnings,0),coalesce(p_taxable_supplementary_pension,0),
    coalesce(p_employee_supplementary_pension,0),p_taxable_compensation,p_fiscal_snapshot,
    coalesce(p_fiscal_snapshot->'overtime','{}'::jsonb),coalesce(p_employee_social,0),
    coalesce(p_employee_health,0),coalesce(p_income_tax,0),coalesce(p_advances_recovered,0),
    coalesce(p_other_deductions,0),coalesce(p_employer_social,0),coalesce(p_employer_health,0),
    v_gross,v_net,0,'calculated'
  ) returning id into v_id;

  update public.payroll_runs r set
    gross_total=coalesce((select sum(gross_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employee_deductions_total=coalesce((select sum(employee_social+employee_health+employee_supplementary_pension+advances_recovered+other_deductions) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employer_contributions_total=coalesce((select sum(employer_social+employer_health+employer_fmfp+taxable_supplementary_pension) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    tax_withheld_total=coalesce((select sum(income_tax) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    net_total=coalesce((select sum(net_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    status=case when r.status='draft' then 'calculated' else r.status end,updated_at=now()
    where r.id=p_run and r.organization_id=p_org;

  perform public.audit_event(p_org,'payslip.calculated','payslip',v_id,null,
    jsonb_build_object('employee_id',p_employee,'payroll_run_id',p_run,'gross_pay',v_gross,
      'net_pay',v_net,'taxable_compensation',p_taxable_compensation,
      'fiscal_snapshot_schema_version',p_fiscal_snapshot->>'schemaVersion'));
  return v_id;
end
$function$;

revoke all on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb) from public,anon;
grant execute on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb) to authenticated,service_role;

create or replace function public.prevent_payslip_fiscal_snapshot_change()
returns trigger language plpgsql set search_path=public
as $$
begin
  if old.fiscal_snapshot is not null and new.fiscal_snapshot is distinct from old.fiscal_snapshot then
    raise exception 'Le snapshot fiscal d’un bulletin est immuable';
  end if;
  if old.overtime_details is not null and new.overtime_details is distinct from old.overtime_details then
    raise exception 'Le détail des heures supplémentaires est immuable';
  end if;
  if old.taxable_compensation is not null and new.taxable_compensation is distinct from old.taxable_compensation then
    raise exception 'L’assiette fiscale classifiée d’un bulletin est immuable';
  end if;
  return new;
end;
$$;

drop trigger if exists payslip_fiscal_snapshot_immutable on public.payslips;
create trigger payslip_fiscal_snapshot_immutable before update on public.payslips
for each row execute function public.prevent_payslip_fiscal_snapshot_change();

revoke all on function public.write_payslip_fiscal_snapshot(uuid,uuid,jsonb) from public,anon;
commit;
