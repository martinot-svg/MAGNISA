-- Version the IRSA dependant reduction and eligibility threshold per effective-dated payroll rule set.
begin;
alter table public.payroll_rule_sets
  add column if not exists irsa_dependant_reduction numeric(18,2) not null default 2000,
  add column if not exists irsa_dependant_threshold numeric(18,2) not null default 350000,
  add column if not exists irsa_pension_deduction_rate numeric(9,6) not null default 0.10;

alter table public.payslips
  add column if not exists employee_supplementary_pension numeric(18,2) not null default 0;
alter table public.payroll_variable_drafts
  add column if not exists employee_supplementary_pension numeric(18,2) not null default 0;

do $do$ begin
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_dependant_reduction_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_dependant_reduction_check check (irsa_dependant_reduction >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_dependant_threshold_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_dependant_threshold_check check (irsa_dependant_threshold >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_health_deduction_rate_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_health_deduction_rate_check check (irsa_health_deduction_rate >= 0 and irsa_health_deduction_rate <= 0.02);
  end if;
  if not exists (select 1 from pg_constraint where conname='payroll_rule_irsa_pension_deduction_rate_check' and conrelid='public.payroll_rule_sets'::regclass) then
    alter table public.payroll_rule_sets add constraint payroll_rule_irsa_pension_deduction_rate_check check (irsa_pension_deduction_rate >= 0 and irsa_pension_deduction_rate <= 0.10);
  end if;
end $do$;

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
    or v_rule.irsa_health_deduction_rate > 0.02
    or v_rule.irsa_pension_deduction_rate is null
    or v_rule.irsa_pension_deduction_rate < 0
    or v_rule.irsa_pension_deduction_rate > 0.10
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
  v_deductible_pension := least(v_social + coalesce(new.employee_supplementary_pension, 0), round(new.gross_pay * v_rule.irsa_pension_deduction_rate, 2));
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


-- Explicit overload keeps legacy RPC callers compatible while recording the employee pension deduction.
create or replace function public.create_payslip(
  p_org uuid, p_run uuid, p_employee uuid,
  p_bonuses numeric, p_overtime numeric, p_other_earnings numeric,
  p_employee_social numeric, p_employee_health numeric, p_income_tax numeric,
  p_advances_recovered numeric, p_other_deductions numeric,
  p_employer_social numeric, p_employer_health numeric,
  p_taxable_supplementary_pension numeric,
  p_employee_supplementary_pension numeric
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare v_employee public.employees%rowtype; v_run public.payroll_runs%rowtype; v_id uuid; v_gross numeric; v_net numeric;
begin
 perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'payroll.manage');
 if least(coalesce(p_bonuses,0),coalesce(p_overtime,0),coalesce(p_other_earnings,0),coalesce(p_employee_social,0),coalesce(p_employee_health,0),coalesce(p_income_tax,0),coalesce(p_advances_recovered,0),coalesce(p_other_deductions,0),coalesce(p_employer_social,0),coalesce(p_employer_health,0),coalesce(p_taxable_supplementary_pension,0),coalesce(p_employee_supplementary_pension,0)) < 0 then raise exception 'Les éléments de paie ne peuvent pas être négatifs'; end if;
 select * into v_employee from public.employees where id=p_employee and organization_id=p_org and status='active'; if not found then raise exception 'Salarié introuvable ou inactif'; end if;
 select * into v_run from public.payroll_runs where id=p_run and organization_id=p_org for update; if not found then raise exception 'Période de paie introuvable'; end if;
 if v_run.status not in ('draft','calculated','review') then raise exception 'Cette période de paie n''est plus modifiable'; end if;
 if exists(select 1 from public.payslips where organization_id=p_org and payroll_run_id=p_run and employee_id=p_employee and status<>'cancelled') then raise exception 'Un bulletin existe déjà pour ce salarié sur cette période'; end if;
 v_gross:=round(coalesce(v_employee.base_salary,0)+coalesce(p_bonuses,0)+coalesce(p_overtime,0)+coalesce(p_other_earnings,0),2);
 v_net:=round(v_gross-coalesce(p_employee_social,0)-coalesce(p_employee_health,0)-coalesce(p_income_tax,0)-coalesce(p_employee_supplementary_pension,0)-coalesce(p_advances_recovered,0)-coalesce(p_other_deductions,0),2);
 if v_net<0 then raise exception 'Le net à payer ne peut pas être négatif'; end if;
 insert into public.payslips(organization_id,payroll_run_id,employee_id,base_salary,bonuses,overtime,other_earnings,taxable_supplementary_pension,employee_supplementary_pension,employee_social,employee_health,income_tax,advances_recovered,other_deductions,employer_social,employer_health,gross_pay,net_pay,paid_amount,status)
 values(p_org,p_run,p_employee,v_employee.base_salary,coalesce(p_bonuses,0),coalesce(p_overtime,0),coalesce(p_other_earnings,0),coalesce(p_taxable_supplementary_pension,0),coalesce(p_employee_supplementary_pension,0),coalesce(p_employee_social,0),coalesce(p_employee_health,0),coalesce(p_income_tax,0),coalesce(p_advances_recovered,0),coalesce(p_other_deductions,0),coalesce(p_employer_social,0),coalesce(p_employer_health,0),v_gross,v_net,0,'calculated') returning id into v_id;
 update public.payroll_runs r set gross_total=coalesce((select sum(gross_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),employee_deductions_total=coalesce((select sum(employee_social+employee_health+employee_supplementary_pension+advances_recovered+other_deductions) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),employer_contributions_total=coalesce((select sum(employer_social+employer_health+employer_fmfp+taxable_supplementary_pension) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),tax_withheld_total=coalesce((select sum(income_tax) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),net_total=coalesce((select sum(net_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),status=case when r.status='draft' then 'calculated' else r.status end,updated_at=now() where r.id=p_run and r.organization_id=p_org;
 perform public.audit_event(p_org,'payslip.calculated','payslip',v_id,null,jsonb_build_object('employee_id',p_employee,'payroll_run_id',p_run,'gross_pay',v_gross,'net_pay',v_net,'taxable_supplementary_pension',coalesce(p_taxable_supplementary_pension,0),'employee_supplementary_pension',coalesce(p_employee_supplementary_pension,0)));
 return v_id;
end $function$;
revoke all on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;


create or replace function public.validate_payslip(p_org uuid, p_payslip uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $function$
declare ps public.payslips%rowtype; v_entry uuid; v_employer_contrib numeric; v_total_cost numeric; v_regular_employer_contrib numeric;
begin
 perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'payroll.manage');
 select * into ps from public.payslips where id=p_payslip and organization_id=p_org for update;
 if not found then raise exception 'Bulletin introuvable'; end if;
 if ps.status<>'calculated' then raise exception 'Seul un bulletin calculé peut être validé'; end if;
 v_employer_contrib:=coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0)+coalesce(ps.employer_fmfp,0)+coalesce(ps.taxable_supplementary_pension,0);
 v_regular_employer_contrib:=coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0);
 v_total_cost:=coalesce(ps.gross_pay,0)+v_employer_contrib;
 if v_total_cost<=0 then raise exception 'Bulletin sans montant à comptabiliser'; end if;
 update public.payslips set status='validated',updated_at=now() where id=ps.id;
 insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit) values(p_org,current_date,'PAIE-'||left(ps.id::text,8),'Validation bulletin de paie','payslip',ps.id,v_total_cost,v_total_cost) returning id into v_entry;
 if ps.gross_pay>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:GROSS','Salaires bruts',ps.gross_pay,0); end if;
 if v_regular_employer_contrib>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','Charges patronales CNaPS et santé',v_regular_employer_contrib,0); end if;
 if ps.employer_fmfp>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'FMFP_PAYABLE','FMFP à payer',0,ps.employer_fmfp); end if;
 if ps.taxable_supplementary_pension>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION','Versement patronal de retraite complémentaire',ps.taxable_supplementary_pension,0); insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'SUPPLEMENTARY_PENSION_PAYABLE','Organisme de retraite complémentaire à payer',0,ps.taxable_supplementary_pension); end if;
 if ps.net_pay>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',0,ps.net_pay); end if;
 if ps.income_tax>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'TAX_PAYABLE:PAYROLL','Retenues fiscales sur salaires',0,ps.income_tax); end if;
 if ps.employee_social+ps.employer_social>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'SOCIAL_PAYABLE','Cotisations sociales à payer',0,ps.employee_social+ps.employer_social); end if;
 if ps.employee_health+ps.employer_health>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'HEALTH_PAYABLE','Cotisations santé à payer',0,ps.employee_health+ps.employer_health); end if;
 if coalesce(ps.employee_supplementary_pension,0)>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE','Cotisation salariale retraite complémentaire à reverser',0,ps.employee_supplementary_pension); end if;
 if ps.advances_recovered>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'EMPLOYEE_ADVANCE_RECEIVABLE','Avances au personnel récupérées',0,ps.advances_recovered); end if;
 if ps.other_deductions>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit) values(p_org,v_entry,'OTHER_PAYROLL_PAYABLE','Autres retenues à reverser',0,ps.other_deductions); end if;
 perform public.audit_event(p_org,'payslip.validated','payslip',ps.id,jsonb_build_object('status','calculated'),jsonb_build_object('status','validated','net_pay',ps.net_pay,'total_cost',v_total_cost,'taxable_supplementary_pension',coalesce(ps.taxable_supplementary_pension,0),'employee_supplementary_pension',coalesce(ps.employee_supplementary_pension,0)));
end $function$;
revoke all on function public.validate_payslip(uuid,uuid) from public,anon;
grant execute on function public.validate_payslip(uuid,uuid) to authenticated;

revoke all on function public.payroll_compute_fmfp_on_insert() from public, anon, authenticated;
commit;
