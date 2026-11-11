-- Align payroll FMFP posting with the verified production ledger implementation.
-- This is a functional correction, not just a structural parity change.
begin;
alter table public.document_templates drop constraint if exists document_templates_document_type_check;
alter table public.document_templates add constraint document_templates_document_type_check
  check (document_type in ('quote','invoice','payslip','report'));
alter table public.payroll_rule_sets drop constraint if exists payroll_rule_sets_organization_id_fkey;
alter table public.payroll_rule_sets add constraint payroll_rule_sets_organization_id_fkey
  foreign key (organization_id) references public.organizations(id) on delete cascade;

CREATE OR REPLACE FUNCTION public.create_payslip(p_org uuid, p_run uuid, p_employee uuid, p_bonuses numeric DEFAULT 0, p_overtime numeric DEFAULT 0, p_other_earnings numeric DEFAULT 0, p_employee_social numeric DEFAULT 0, p_employee_health numeric DEFAULT 0, p_income_tax numeric DEFAULT 0, p_advances_recovered numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0, p_employer_social numeric DEFAULT 0, p_employer_health numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee public.employees%rowtype;
  v_run public.payroll_runs%rowtype;
  v_id uuid;
  v_gross numeric;
  v_net numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'payroll.manage');

  if least(
    coalesce(p_bonuses,0),coalesce(p_overtime,0),coalesce(p_other_earnings,0),
    coalesce(p_employee_social,0),coalesce(p_employee_health,0),coalesce(p_income_tax,0),
    coalesce(p_advances_recovered,0),coalesce(p_other_deductions,0),
    coalesce(p_employer_social,0),coalesce(p_employer_health,0)
  ) < 0 then
    raise exception 'Les éléments de paie ne peuvent pas être négatifs';
  end if;

  select * into v_employee
  from public.employees
  where id=p_employee and organization_id=p_org and status='active';

  if not found then raise exception 'Salarié introuvable ou inactif'; end if;

  select * into v_run
  from public.payroll_runs
  where id=p_run and organization_id=p_org
  for update;

  if not found then raise exception 'Période de paie introuvable'; end if;
  if v_run.status not in ('draft','calculated','review') then
    raise exception 'Cette période de paie n''est plus modifiable';
  end if;

  if exists(
    select 1 from public.payslips
    where organization_id=p_org and payroll_run_id=p_run and employee_id=p_employee
      and status <> 'cancelled'
  ) then
    raise exception 'Un bulletin existe déjà pour ce salarié sur cette période';
  end if;

  v_gross := round(
    coalesce(v_employee.base_salary,0)+coalesce(p_bonuses,0)+coalesce(p_overtime,0)+coalesce(p_other_earnings,0),
    2
  );
  v_net := round(
    v_gross
    - coalesce(p_employee_social,0)
    - coalesce(p_employee_health,0)
    - coalesce(p_income_tax,0)
    - coalesce(p_advances_recovered,0)
    - coalesce(p_other_deductions,0),
    2
  );

  if v_net < 0 then raise exception 'Le net à payer ne peut pas être négatif'; end if;

  insert into public.payslips(
    organization_id,payroll_run_id,employee_id,base_salary,bonuses,overtime,other_earnings,
    employee_social,employee_health,income_tax,advances_recovered,other_deductions,
    employer_social,employer_health,gross_pay,net_pay,paid_amount,status
  )
  values(
    p_org,p_run,p_employee,v_employee.base_salary,coalesce(p_bonuses,0),coalesce(p_overtime,0),coalesce(p_other_earnings,0),
    coalesce(p_employee_social,0),coalesce(p_employee_health,0),coalesce(p_income_tax,0),
    coalesce(p_advances_recovered,0),coalesce(p_other_deductions,0),
    coalesce(p_employer_social,0),coalesce(p_employer_health,0),
    v_gross,v_net,0,'calculated'
  )
  returning id into v_id;

  update public.payroll_runs r
  set
    gross_total = coalesce((select sum(gross_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employee_deductions_total = coalesce((select sum(employee_social+employee_health+advances_recovered+other_deductions) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employer_contributions_total = coalesce((select sum(employer_social+employer_health+employer_fmfp) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    tax_withheld_total = coalesce((select sum(income_tax) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    net_total = coalesce((select sum(net_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    status = case when r.status='draft' then 'calculated' else r.status end,
    updated_at=now()
  where r.id=p_run and r.organization_id=p_org;

  perform public.audit_event(
    p_org,'payslip.calculated','payslip',v_id,null,
    jsonb_build_object('employee_id',p_employee,'payroll_run_id',p_run,'gross_pay',v_gross,'net_pay',v_net)
  );

  return v_id;
end;
$function$
;
revoke all on function public.create_payslip(p_org uuid, p_run uuid, p_employee uuid, p_bonuses numeric, p_overtime numeric, p_other_earnings numeric, p_employee_social numeric, p_employee_health numeric, p_income_tax numeric, p_advances_recovered numeric, p_other_deductions numeric, p_employer_social numeric, p_employer_health numeric) from public, anon;
grant execute on function public.create_payslip(p_org uuid, p_run uuid, p_employee uuid, p_bonuses numeric, p_overtime numeric, p_other_earnings numeric, p_employee_social numeric, p_employee_health numeric, p_income_tax numeric, p_advances_recovered numeric, p_other_deductions numeric, p_employer_social numeric, p_employer_health numeric) to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.validate_payslip(p_org uuid, p_payslip uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ps public.payslips%rowtype;
  v_entry uuid;
  v_employer_contrib numeric;
  v_total_cost numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'payroll.manage');

  select * into ps
  from public.payslips
  where id=p_payslip and organization_id=p_org
  for update;

  if not found then raise exception 'Bulletin introuvable'; end if;
  if ps.status <> 'calculated' then raise exception 'Seul un bulletin calculé peut être validé'; end if;

  v_employer_contrib := coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0)+coalesce(ps.employer_fmfp,0);
  v_total_cost := coalesce(ps.gross_pay,0)+v_employer_contrib;

  if v_total_cost <= 0 then raise exception 'Bulletin sans montant à comptabiliser'; end if;

  update public.payslips
  set status='validated',updated_at=now()
  where id=ps.id;

  insert into public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  values(
    p_org,current_date,'PAIE-'||left(ps.id::text,8),'Validation bulletin de paie',
    'payslip',ps.id,v_total_cost,v_total_cost
  )
  returning id into v_entry;

  if ps.gross_pay > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'PAYROLL_EXPENSE:GROSS','Salaires bruts',ps.gross_pay,0);
  end if;

  if v_employer_contrib > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','Charges patronales',v_employer_contrib-ps.employer_fmfp,0);
  end if;

  
  if ps.employer_fmfp > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values(p_org,v_entry,'FMFP_PAYABLE','FMFP à payer',0,ps.employer_fmfp);
  end if;
  if ps.net_pay > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',0,ps.net_pay);
  end if;

  if ps.income_tax > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'TAX_PAYABLE:PAYROLL','Retenues fiscales sur salaires',0,ps.income_tax);
  end if;

  if ps.employee_social + ps.employer_social > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'SOCIAL_PAYABLE','Cotisations sociales à payer',0,ps.employee_social+ps.employer_social);
  end if;

  if ps.employee_health + ps.employer_health > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'HEALTH_PAYABLE','Cotisations santé à payer',0,ps.employee_health+ps.employer_health);
  end if;

  if ps.advances_recovered > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'EMPLOYEE_ADVANCE_RECEIVABLE','Avances au personnel récupérées',0,ps.advances_recovered);
  end if;

  if ps.other_deductions > 0 then
    insert into public.journal_entry_lines(
      organization_id,journal_entry_id,account_key,account_label,debit,credit
    ) values (p_org,v_entry,'OTHER_PAYROLL_PAYABLE','Autres retenues à reverser',0,ps.other_deductions);
  end if;

  perform public.audit_event(
    p_org,'payslip.validated','payslip',ps.id,
    jsonb_build_object('status','calculated'),
    jsonb_build_object('status','validated','net_pay',ps.net_pay,'total_cost',v_total_cost)
  );
end;
$function$
;
revoke all on function public.validate_payslip(p_org uuid, p_payslip uuid) from public, anon;
grant execute on function public.validate_payslip(p_org uuid, p_payslip uuid) to authenticated, service_role;

commit;
