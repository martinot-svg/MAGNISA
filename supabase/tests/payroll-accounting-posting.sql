-- Verify IRSA treatment of employer-funded supplementary pension and balanced payroll posting.
-- Fixtures are isolated and rolled back.
begin;

do $test$
declare
  v_org uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_employee_pension uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_rule uuid := gen_random_uuid();
  v_payslip uuid;
  v_payslip_employee_pension uuid;
  v_entry uuid;
  v_status text;
  v_tax numeric;
  v_net numeric;
  v_fmfp numeric;
  v_pension numeric;
  v_employer_total numeric;
  v_debit numeric;
  v_credit numeric;
  v_fmfp_expense_count integer;
  v_pension_expense_count integer;
  v_pension_payable_count integer;
  v_employee_pension_payable_count integer;
begin
  insert into auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values (
    v_owner,'authenticated','authenticated',v_owner::text||'@payroll-posting.test',
    '',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
  );

  insert into public.organizations(id,name)
  values(v_org,'Payroll accounting posting integration test');

  insert into public.organization_members(organization_id,user_id,role,status)
  values(v_org,v_owner,'owner','active');

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  perform set_config('app.payroll_rule_activation','on',true);

  -- Synthetic 3% employee health rate verifies the statutory 2% IRSA deduction cap.
  insert into public.payroll_rule_sets(
    id,organization_id,name,effective_from,effective_to,status,
    cnaps_employee_rate,cnaps_employer_rate,
    health_employee_rate,health_employer_rate,fmfp_employer_rate,
    cnaps_monthly_ceiling,health_monthly_ceiling,
    irsa_brackets,irsa_minimum,rounding_policy,legal_reference,
    reviewed_by,reviewed_at
  ) values (
    v_rule,v_org,'TEST payroll 2026',current_date-1,null,'validated',
    0.01,0.13,0.03,0.08,0.01,
    2400000,1600000,
    '[{"up_to":350000,"rate":0},{"up_to":400000,"rate":0.05},{"up_to":500000,"rate":0.10},{"up_to":600000,"rate":0.15},{"up_to":4000000,"rate":0.20},{"up_to":null,"rate":0.25}]'::jsonb,
    3000,'floor_100','TEST ONLY',v_owner,now()
  );

  insert into public.employees(id,organization_id,first_name,last_name,base_salary,status,irsa_dependants)
  values(v_employee,v_org,'Test','Payroll',1000000,'active',0);

  insert into public.payroll_runs(id,organization_id,period_start,period_end,status,created_by)
  values(v_run,v_org,date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date,'draft',v_owner);

  -- IRSA base includes the Ar 100,000 taxable supplementary pension contribution.
  v_payslip := public.create_payslip(
    p_org => v_org,
    p_run => v_run,
    p_employee => v_employee,
    p_bonuses => 0,
    p_overtime => 0,
    p_other_earnings => 0,
    p_employee_social => 10000,
    p_employee_health => 30000,
    p_income_tax => 121500,
    p_advances_recovered => 0,
    p_other_deductions => 0,
    p_employer_social => 130000,
    p_employer_health => 80000,
    p_taxable_supplementary_pension => 100000
  );

  select income_tax,net_pay,employer_fmfp,taxable_supplementary_pension,status
    into v_tax,v_net,v_fmfp,v_pension,v_status
    from public.payslips where id=v_payslip;

  if v_status <> 'calculated' or v_tax <> 121500 or v_net <> 838500
    or v_fmfp <> 10000 or v_pension <> 100000 then
    raise exception 'TEST FAILED: payslip values do not include taxable supplementary pension correctly';
  end if;

  select employer_contributions_total into v_employer_total
    from public.payroll_runs where id=v_run;
  if v_employer_total <> 320000 then
    raise exception 'TEST FAILED: employer contribution total should include social, health, FMFP and supplementary pension';
  end if;

  perform public.validate_payslip(v_org,v_payslip);

  select id into v_entry
    from public.journal_entries
   where organization_id=v_org and source_type='payslip' and source_id=v_payslip;

  if v_entry is null then
    raise exception 'TEST FAILED: payroll journal entry was not created';
  end if;

  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit
    from public.journal_entry_lines
   where journal_entry_id=v_entry;

  if v_debit <> v_credit or v_debit <> 1320000 then
    raise exception 'TEST FAILED: payroll journal lines are not balanced at total employer cost';
  end if;

  select count(*) into v_fmfp_expense_count
    from public.journal_entry_lines
   where journal_entry_id=v_entry and account_key='PAYROLL_EXPENSE:FMFP' and debit=10000 and credit=0;

  select count(*) into v_pension_expense_count
    from public.journal_entry_lines
   where journal_entry_id=v_entry and account_key='PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION' and debit=100000 and credit=0;

  select count(*) into v_pension_payable_count
    from public.journal_entry_lines
   where journal_entry_id=v_entry and account_key='SUPPLEMENTARY_PENSION_PAYABLE' and debit=0 and credit=100000;

  if v_fmfp_expense_count <> 1 or v_pension_expense_count <> 1 or v_pension_payable_count <> 1 then
    raise exception 'TEST FAILED: FMFP or supplementary pension expense/payable posting is missing or duplicated';
  end if;

  insert into public.employees(id,organization_id,first_name,last_name,base_salary,status,irsa_dependants)
  values(v_employee_pension,v_org,'Test','Employee pension',1000000,'active',0);

  -- Employee-funded supplementary pension is deducted from net and from IRSA base within the 10% cap.
  v_payslip_employee_pension := public.create_payslip(
    p_org => v_org,
    p_run => v_run,
    p_employee => v_employee_pension,
    p_bonuses => 0,
    p_overtime => 0,
    p_other_earnings => 0,
    p_employee_social => 10000,
    p_employee_health => 10000,
    p_income_tax => 93500,
    p_advances_recovered => 0,
    p_other_deductions => 0,
    p_employer_social => 130000,
    p_employer_health => 50000,
    p_taxable_supplementary_pension => 0,
    p_employee_supplementary_pension => 50000
  );

  select income_tax,net_pay,employee_supplementary_pension,status
    into v_tax,v_net,v_pension,v_status
    from public.payslips where id=v_payslip_employee_pension;
  if v_status <> 'calculated' or v_tax <> 93500 or v_net <> 836500 or v_pension <> 50000 then
    raise exception 'TEST FAILED: employee supplementary pension was not deducted and taxed correctly';
  end if;

  perform public.validate_payslip(v_org,v_payslip_employee_pension);
  select id into v_entry from public.journal_entries
   where organization_id=v_org and source_type='payslip' and source_id=v_payslip_employee_pension;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit from public.journal_entry_lines where journal_entry_id=v_entry;
  if v_debit <> v_credit or v_debit <> 1190000 then
    raise exception 'TEST FAILED: employee supplementary pension journal entry is not balanced';
  end if;
  select count(*) into v_employee_pension_payable_count
    from public.journal_entry_lines
   where journal_entry_id=v_entry and account_key='EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE'
     and debit=0 and credit=50000;
  if v_employee_pension_payable_count <> 1 then
    raise exception 'TEST FAILED: employee supplementary pension payable line is missing or duplicated';
  end if;

  select status into v_status from public.payslips where id=v_payslip;
  if v_status <> 'validated' then
    raise exception 'TEST FAILED: payslip did not reach validated status';
  end if;
end
$test$;

rollback;
