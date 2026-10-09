-- MAGNISA 0013
-- Transactional hardening for supplier accounting, payroll accounting,
-- immutable financial ledgers, and client privilege reduction.

create or replace function public.record_supplier_invoice(
  p_org uuid,
  p_supplier uuid,
  p_supplier_number text,
  p_invoice_date date,
  p_due_date date,
  p_total numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  v_entry uuid;
  v_supplier_name text;
  v_ref text;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'suppliers.manage');

  if p_total is null or p_total <= 0 then raise exception 'Montant invalide'; end if;
  if p_invoice_date is null then raise exception 'Date de facture requise'; end if;
  if p_due_date is not null and p_due_date < p_invoice_date then
    raise exception 'L''échéance ne peut pas précéder la date de facture';
  end if;

  v_ref := nullif(trim(coalesce(p_supplier_number,'')),'');
  if v_ref is null then raise exception 'Numéro de facture fournisseur requis'; end if;

  select name into v_supplier_name
  from public.suppliers
  where id=p_supplier and organization_id=p_org and is_active
  for share;
  if not found then raise exception 'Fournisseur introuvable ou inactif'; end if;

  insert into public.supplier_invoices(
    organization_id,supplier_id,supplier_number,invoice_date,due_date,
    subtotal,tax_total,total,paid_amount,balance_due,status,notes,created_by
  )
  values(
    p_org,p_supplier,v_ref,p_invoice_date,p_due_date,
    p_total,0,p_total,0,p_total,'validated',nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  )
  returning id into v_invoice;

  insert into public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  values(
    p_org,p_invoice_date,'FOUR-'||v_ref,
    'Facture fournisseur '||v_supplier_name||' — '||v_ref,
    'supplier_invoice',v_invoice,p_total,p_total
  )
  returning id into v_entry;

  insert into public.journal_entry_lines(
    organization_id,journal_entry_id,account_key,account_label,debit,credit
  )
  values
    (p_org,v_entry,'EXPENSE:SUPPLIER','Achats et sous-traitance',p_total,0),
    (p_org,v_entry,'AP','Dettes fournisseurs',0,p_total);

  perform public.audit_event(
    p_org,'supplier_invoice.validated','supplier_invoice',v_invoice,null,
    jsonb_build_object('supplier_id',p_supplier,'supplier_number',v_ref,'total',p_total)
  );

  return v_invoice;
end;
$$;

revoke all on function public.record_supplier_invoice(uuid,uuid,text,date,date,numeric,text) from public;
grant execute on function public.record_supplier_invoice(uuid,uuid,text,date,date,numeric,text) to authenticated, service_role;

create or replace function public.create_payslip(
  p_org uuid,
  p_run uuid,
  p_employee uuid,
  p_bonuses numeric default 0,
  p_overtime numeric default 0,
  p_other_earnings numeric default 0,
  p_employee_social numeric default 0,
  p_employee_health numeric default 0,
  p_income_tax numeric default 0,
  p_advances_recovered numeric default 0,
  p_other_deductions numeric default 0,
  p_employer_social numeric default 0,
  p_employer_health numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    coalesce(v_employee.base_salary,0)+coalesce(p_bonuses,0)+coalesce(p_overtime,0)+coalesce(p_other_earnings,0),2
  );
  v_net := round(
    v_gross-coalesce(p_employee_social,0)-coalesce(p_employee_health,0)-coalesce(p_income_tax,0)
    -coalesce(p_advances_recovered,0)-coalesce(p_other_deductions,0),2
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
    coalesce(p_employer_social,0),coalesce(p_employer_health,0),v_gross,v_net,0,'calculated'
  )
  returning id into v_id;

  update public.payroll_runs r
  set
    gross_total = coalesce((select sum(gross_pay) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employee_deductions_total = coalesce((select sum(employee_social+employee_health+advances_recovered+other_deductions) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
    employer_contributions_total = coalesce((select sum(employer_social+employer_health) from public.payslips where payroll_run_id=r.id and status<>'cancelled'),0),
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
$$;

revoke all on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public;
grant execute on function public.create_payslip(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated, service_role;

create or replace function public.validate_payslip(p_org uuid, p_payslip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ps public.payslips%rowtype;
  v_entry uuid;
  v_employer_contrib numeric;
  v_total_cost numeric;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'payroll.manage');

  select * into ps from public.payslips
  where id=p_payslip and organization_id=p_org
  for update;
  if not found then raise exception 'Bulletin introuvable'; end if;
  if ps.status <> 'calculated' then raise exception 'Seul un bulletin calculé peut être validé'; end if;

  v_employer_contrib := coalesce(ps.employer_social,0)+coalesce(ps.employer_health,0);
  v_total_cost := coalesce(ps.gross_pay,0)+v_employer_contrib;
  if v_total_cost <= 0 then raise exception 'Bulletin sans montant à comptabiliser'; end if;

  update public.payslips set status='validated',updated_at=now() where id=ps.id;

  insert into public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  values(p_org,current_date,'PAIE-'||left(ps.id::text,8),'Validation bulletin de paie','payslip',ps.id,v_total_cost,v_total_cost)
  returning id into v_entry;

  if ps.gross_pay > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'PAYROLL_EXPENSE:GROSS','Salaires bruts',ps.gross_pay,0);
  end if;
  if v_employer_contrib > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','Charges patronales',v_employer_contrib,0);
  end if;
  if ps.net_pay > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',0,ps.net_pay);
  end if;
  if ps.income_tax > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'TAX_PAYABLE:PAYROLL','Retenues fiscales sur salaires',0,ps.income_tax);
  end if;
  if ps.employee_social + ps.employer_social > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'SOCIAL_PAYABLE','Cotisations sociales à payer',0,ps.employee_social+ps.employer_social);
  end if;
  if ps.employee_health + ps.employer_health > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'HEALTH_PAYABLE','Cotisations santé à payer',0,ps.employee_health+ps.employer_health);
  end if;
  if ps.advances_recovered > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'EMPLOYEE_ADVANCE_RECEIVABLE','Avances au personnel récupérées',0,ps.advances_recovered);
  end if;
  if ps.other_deductions > 0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit)
    values (p_org,v_entry,'OTHER_PAYROLL_PAYABLE','Autres retenues à reverser',0,ps.other_deductions);
  end if;

  perform public.audit_event(
    p_org,'payslip.validated','payslip',ps.id,
    jsonb_build_object('status','calculated'),
    jsonb_build_object('status','validated','net_pay',ps.net_pay,'total_cost',v_total_cost)
  );
end;
$$;

revoke all on function public.validate_payslip(uuid,uuid) from public;
grant execute on function public.validate_payslip(uuid,uuid) to authenticated, service_role;

create or replace function public.record_payroll_payment(
  p_org uuid,p_payslip uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps public.payslips%rowtype;
  a public.financial_accounts%rowtype;
  v_id uuid;
  v_entry uuid;
  v_new_paid numeric;
  v_ref text;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'payroll.pay');
  if p_amount is null or p_amount<=0 then raise exception 'Montant invalide'; end if;

  select * into ps from public.payslips where id=p_payslip and organization_id=p_org for update;
  if not found then raise exception 'Bulletin introuvable'; end if;
  if ps.status not in ('validated','partially_paid') then raise exception 'Le bulletin doit être validé avant paiement'; end if;
  if ps.paid_amount+p_amount>ps.net_pay then raise exception 'Le paiement dépasse le net à payer'; end if;

  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide'; end if;

  v_ref := coalesce(nullif(trim(coalesce(p_reference,'')),''),'SAL-'||left(ps.id::text,8));

  insert into public.payroll_payments(
    organization_id,payslip_id,employee_id,financial_account_id,amount,payment_date,method,reference,created_by
  )
  values(p_org,ps.id,ps.employee_id,a.id,p_amount,p_date,p_method,v_ref,auth.uid())
  returning id into v_id;

  v_new_paid:=ps.paid_amount+p_amount;
  update public.payslips
  set paid_amount=v_new_paid,status=case when v_new_paid=net_pay then 'paid' else 'partially_paid' end,updated_at=now()
  where id=ps.id;

  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a.id;

  insert into public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  )
  values(p_org,a.id,p_date,-p_amount,'expense','payroll_payment',v_id,v_ref,'Paiement salaire');

  insert into public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  values(p_org,p_date,v_ref,'Paiement salaire','payroll_payment',v_id,p_amount,p_amount)
  returning id into v_entry;

  insert into public.journal_entry_lines(
    organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id
  )
  values
    (p_org,v_entry,'PAYROLL_PAYABLE','Salaires nets à payer',p_amount,0,null),
    (p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);

  perform public.audit_event(
    p_org,'payroll_payment.recorded','payroll_payment',v_id,null,
    jsonb_build_object('payslip_id',ps.id,'amount',p_amount,'account_id',a.id)
  );
  return v_id;
end;
$$;

create or replace function public.record_supplier_payment(
  p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  si public.supplier_invoices%rowtype;
  a public.financial_accounts%rowtype;
  v_id uuid;
  v_entry uuid;
  v_new_paid numeric;
  v_new_balance numeric;
  v_ref text;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'suppliers.manage');
  if p_amount is null or p_amount<=0 then raise exception 'Montant invalide'; end if;

  select * into si from public.supplier_invoices where id=p_supplier_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture fournisseur introuvable'; end if;
  if si.status='cancelled' then raise exception 'Facture fournisseur annulée'; end if;
  if p_amount>si.balance_due then raise exception 'Le paiement dépasse le solde dû'; end if;

  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide'; end if;

  v_ref := coalesce(nullif(trim(coalesce(p_reference,'')),''),'FOUR-PAY-'||left(si.id::text,8));

  insert into public.supplier_payments(
    organization_id,supplier_invoice_id,supplier_id,financial_account_id,amount,payment_date,reference,method,created_by
  )
  values(p_org,si.id,si.supplier_id,a.id,p_amount,p_date,v_ref,p_method,auth.uid())
  returning id into v_id;

  v_new_paid:=si.paid_amount+p_amount;
  v_new_balance:=greatest(si.total-v_new_paid,0);
  update public.supplier_invoices
  set paid_amount=v_new_paid,balance_due=v_new_balance,
      status=case when v_new_balance=0 then 'paid' else 'partially_paid' end,updated_at=now()
  where id=si.id;

  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a.id;

  insert into public.financial_transactions(
    organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description
  )
  values(p_org,a.id,p_date,-p_amount,'expense','supplier_payment',v_id,v_ref,'Règlement fournisseur');

  insert into public.journal_entries(
    organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit
  )
  values(p_org,p_date,v_ref,'Règlement fournisseur','supplier_payment',v_id,p_amount,p_amount)
  returning id into v_entry;

  insert into public.journal_entry_lines(
    organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id
  )
  values
    (p_org,v_entry,'AP','Dettes fournisseurs',p_amount,0,null),
    (p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);

  perform public.audit_event(
    p_org,'supplier_payment.recorded','supplier_payment',v_id,null,
    jsonb_build_object('supplier_invoice_id',si.id,'amount',p_amount,'account_id',a.id)
  );
  return v_id;
end;
$$;

revoke delete on all tables in schema public from authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke insert, update on public.payments from authenticated;
revoke insert, update on public.expenses from authenticated;
revoke insert, update on public.financial_transactions from authenticated;
revoke insert, update on public.journal_entries from authenticated;
revoke insert, update on public.journal_entry_lines from authenticated;
revoke insert, update on public.supplier_payments from authenticated;
revoke insert, update on public.payroll_payments from authenticated;
revoke insert, update on public.supplier_invoices from authenticated;
revoke insert, update on public.payslips from authenticated;

revoke update on public.financial_accounts from authenticated;
grant update (name,type,external_reference,is_active,updated_at) on public.financial_accounts to authenticated;

grant execute on function public.record_supplier_payment(uuid,uuid,uuid,numeric,text,date,text) to authenticated, service_role;
grant execute on function public.record_payroll_payment(uuid,uuid,uuid,numeric,text,date,text) to authenticated, service_role;
grant execute on function public.record_expense(uuid,text,numeric,date,uuid,text) to authenticated, service_role;
grant execute on function public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text) to authenticated, service_role;
grant execute on function public.transfer_funds(uuid,uuid,uuid,numeric,date,text) to authenticated, service_role;
