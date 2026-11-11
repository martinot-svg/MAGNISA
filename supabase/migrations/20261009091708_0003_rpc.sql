create or replace function public.assert_org_access(p_org uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.organization_members
    where organization_id=p_org and user_id=auth.uid() and status='active'
  ) then raise exception 'Accès refusé à cette organisation'; end if;
end;$$;

create or replace function public.audit_event(p_org uuid,p_action text,p_entity text,p_id uuid,p_old jsonb default null,p_new jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,old_values,new_values)
  values(p_org,auth.uid(),p_action,p_entity,p_id,p_old,p_new);
end;$$;

create or replace function public.create_organization(p_name text,p_currency text default 'MGA')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Nom d''entreprise invalide'; end if;
  insert into public.organizations(name,currency) values(trim(p_name),upper(trim(p_currency))) returning id into v_org;
  insert into public.organization_members(organization_id,user_id,role,status) values(v_org,auth.uid(),'owner','active');
  insert into public.company_settings(organization_id,legal_name) values(v_org,trim(p_name));
  insert into public.number_sequences(organization_id,document_type,prefix,next_value,padding) values
    (v_org,'quote','DEV-',1,5),(v_org,'invoice','FAC-',1,5),(v_org,'payment','PAY-',1,5),(v_org,'expense','DEP-',1,5);
  perform public.audit_event(v_org,'organization.created','organization',v_org,null,jsonb_build_object('name',p_name,'currency',p_currency));
  return v_org;
end;$$;

create or replace function public.next_document_number(p_org uuid,p_type text)
returns text language plpgsql security definer set search_path=public as $$
declare v_prefix text;v_next bigint;v_padding int;
begin
  perform public.assert_org_access(p_org);
  select prefix,next_value,padding into v_prefix,v_next,v_padding
  from public.number_sequences where organization_id=p_org and document_type=p_type for update;
  if not found then raise exception 'Séquence de numérotation non configurée pour %',p_type;end if;
  update public.number_sequences set next_value=v_next+1,updated_at=now()
  where organization_id=p_org and document_type=p_type;
  return v_prefix||lpad(v_next::text,v_padding,'0');
end;$$;

create or replace function public.create_quote_from_service(p_org uuid,p_customer uuid,p_service uuid,p_quantity numeric,p_discount_pct numeric,p_valid_until date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_s public.services%rowtype;v_id uuid;v_number text;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;
begin
  perform public.assert_org_access(p_org);
  if p_quantity <= 0 then raise exception 'Quantité invalide'; end if;
  if p_discount_pct < 0 or p_discount_pct > 100 then raise exception 'Remise invalide'; end if;
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
  select * into v_s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  if p_valid_until < current_date then raise exception 'Date de validité invalide';end if;
  v_gross:=round(p_quantity*v_s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*v_s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  v_number:=public.next_document_number(p_org,'quote');
  insert into public.quotes(organization_id,customer_id,number,valid_until,subtotal,discount_total,tax_total,total,created_by)
  values(p_org,p_customer,v_number,p_valid_until,v_taxable,v_discount,v_tax,v_total,auth.uid()) returning id into v_id;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_id,v_s.id,v_s.name,p_quantity,v_s.unit,v_s.unit_price,p_discount_pct,v_discount,v_taxable,v_s.tax_rate,v_tax,v_total,1);
  perform public.audit_event(p_org,'quote.created','quote',v_id,null,jsonb_build_object('number',v_number,'total',v_total));
  return v_id;
end;$$;

create or replace function public.accept_quote(p_org uuid,p_quote uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  perform public.assert_org_access(p_org);
  select status into v_status from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if v_status not in ('draft','sent','negotiating') then raise exception 'Statut incompatible'; end if;
  update public.quotes set status='accepted',accepted_at=now(),updated_at=now() where id=p_quote;
  perform public.audit_event(p_org,'quote.accepted','quote',p_quote,jsonb_build_object('status',v_status),jsonb_build_object('status','accepted'));
end;$$;

create or replace function public.convert_quote_to_invoice(p_org uuid,p_quote uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare q public.quotes%rowtype;v_invoice uuid;v_number text;v_days int;
begin
  perform public.assert_org_access(p_org);
  select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable';end if;
  if q.status <> 'accepted' then raise exception 'Seul un devis accepté peut être converti';end if;
  if exists(select 1 from public.invoices where quote_id=p_quote and organization_id=p_org) then raise exception 'Ce devis possède déjà une facture';end if;
  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,q.customer_id,q.id,v_number,'draft',current_date,current_date+coalesce(v_days,30),q.subtotal,q.discount_total,q.tax_total,q.total,0,q.total,q.notes,auth.uid()) returning id into v_invoice;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_invoice,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order from public.quote_lines where quote_id=q.id;
  update public.quotes set status='converted',updated_at=now() where id=q.id;
  perform public.audit_event(p_org,'quote.converted','quote',q.id,jsonb_build_object('status','accepted'),jsonb_build_object('status','converted','invoice_id',v_invoice));
  return v_invoice;
end;$$;

create or replace function public.create_direct_invoice_from_service(p_org uuid,p_customer uuid,p_service uuid,p_quantity numeric,p_discount_pct numeric,p_due_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_s public.services%rowtype;v_id uuid;v_number text;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;
begin
  perform public.assert_org_access(p_org);
  if p_quantity<=0 then raise exception 'Quantité invalide';end if;
  if p_discount_pct<0 or p_discount_pct>100 then raise exception 'Remise invalide';end if;
  if p_due_date<current_date then raise exception 'Échéance invalide';end if;
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
  select * into v_s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  v_gross:=round(p_quantity*v_s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*v_s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
  values(p_org,p_customer,v_number,'draft',current_date,p_due_date,v_taxable,v_discount,v_tax,v_total,0,v_total,auth.uid()) returning id into v_id;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_id,v_s.id,v_s.name,p_quantity,v_s.unit,v_s.unit_price,p_discount_pct,v_discount,v_taxable,v_s.tax_rate,v_tax,v_total,1);
  perform public.audit_event(p_org,'invoice.created_direct','invoice',v_id,null,jsonb_build_object('number',v_number,'total',v_total));
  return v_id;
end;$$;

create or replace function public.issue_invoice(p_org uuid,p_invoice uuid)
returns void language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype;v_entry uuid;
begin
  perform public.assert_org_access(p_org);
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable';end if;
  if i.status<>'draft' then raise exception 'Seule une facture brouillon peut être émise';end if;
  if i.total<=0 then raise exception 'Total invalide';end if;
  update public.invoices set status='issued',issued_at=now(),balance_due=total-paid_amount,updated_at=now() where id=i.id;
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,i.issue_date,i.number,'Émission facture '||i.number,'invoice',i.id,i.total,i.total) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id) values
    (p_org,v_entry,'AR','Créances clients',i.total,0,i.customer_id),
    (p_org,v_entry,'SALES_REVENUE','Chiffre d''affaires services',0,i.subtotal,i.customer_id);
  if i.tax_total>0 then
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id)
    values(p_org,v_entry,'TAX_PAYABLE','Taxes collectées à payer',0,i.tax_total,i.customer_id);
  end if;
  perform public.audit_event(p_org,'invoice.issued','invoice',i.id,jsonb_build_object('status','draft'),jsonb_build_object('status','issued'));
end;$$;

create or replace function public.record_invoice_payment(p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype;a public.financial_accounts%rowtype;v_payment uuid;v_entry uuid;v_new_paid numeric;v_balance numeric;v_status text;v_number text;
begin
  perform public.assert_org_access(p_org);
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable';end if;
  if i.status in ('draft','cancelled') then raise exception 'Paiement impossible sur cette facture';end if;
  if p_amount>i.balance_due then raise exception 'Le paiement dépasse le solde restant';end if;
  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide';end if;
  if p_method='cheque' and a.type<>'cheque_clearing' then raise exception 'Un chèque reçu doit aller dans Chèques à encaisser';end if;
  v_number:=public.next_document_number(p_org,'payment');
  insert into public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
  values(p_org,i.id,i.customer_id,a.id,coalesce(nullif(trim(p_reference),''),v_number),p_amount,p_method,'confirmed',p_paid_at,auth.uid()) returning id into v_payment;
  update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,a.id,p_paid_at,p_amount,'customer_payment','payment',v_payment,coalesce(nullif(trim(p_reference),''),v_number),'Paiement facture '||i.number);
  v_new_paid:=i.paid_amount+p_amount;v_balance:=i.total-v_new_paid;
  v_status:=case when v_balance=0 then 'paid' when i.due_date is not null and i.due_date<current_date then 'overdue' else 'partially_paid' end;
  update public.invoices set paid_amount=v_new_paid,balance_due=v_balance,status=v_status,updated_at=now() where id=i.id;
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_paid_at,coalesce(nullif(trim(p_reference),''),v_number),'Encaissement '||i.number,'payment',v_payment,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id) values
    (p_org,v_entry,'TREASURY:'||a.id::text,a.name,p_amount,0,a.id,i.customer_id),
    (p_org,v_entry,'AR','Créances clients',0,p_amount,null,i.customer_id);
  perform public.audit_event(p_org,'payment.recorded','payment',v_payment,null,jsonb_build_object('invoice_id',i.id,'amount',p_amount,'account_id',a.id));
  return v_payment;
end;$$;

create or replace function public.record_expense(p_org uuid,p_description text,p_amount numeric,p_date date,p_account uuid,p_category text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.financial_accounts%rowtype;v_expense uuid;v_entry uuid;v_number text;
begin
  perform public.assert_org_access(p_org);
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  if length(trim(p_description))<2 then raise exception 'Description requise';end if;
  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide';end if;
  v_number:=public.next_document_number(p_org,'expense');
  insert into public.expenses(organization_id,financial_account_id,description,category,amount,expense_date,status,created_by)
  values(p_org,a.id,trim(p_description),trim(p_category),p_amount,p_date,'paid',auth.uid()) returning id into v_expense;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,a.id,p_date,-p_amount,'expense','expense',v_expense,v_number,p_description);
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_date,v_number,p_description,'expense',v_expense,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) values
    (p_org,v_entry,'EXPENSE:'||lower(regexp_replace(trim(p_category),'[^a-zA-Z0-9]+','_','g')),p_category,p_amount,0,null),
    (p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);
  perform public.audit_event(p_org,'expense.recorded','expense',v_expense,null,jsonb_build_object('amount',p_amount,'category',p_category));
  return v_expense;
end;$$;

create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_org_access(p_org);
  update public.invoices set status='overdue',updated_at=now()
  where organization_id=p_org and status in ('issued','partially_paid') and balance_due>0 and due_date<current_date;
  return jsonb_build_object(
    'revenue',coalesce((select sum(subtotal) from public.invoices where organization_id=p_org and status not in ('draft','cancelled')),0),
    'receipts',coalesce((select sum(amount) from public.payments where organization_id=p_org and status in ('confirmed','reconciled')),0),
    'expenses',coalesce((select sum(amount) from public.expenses where organization_id=p_org and status in ('validated','paid')),0),
    'receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and status not in ('draft','cancelled','paid')),0),
    'cash_available',coalesce((select sum(balance) from public.financial_accounts where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')),0),
    'invoice_count',(select count(*) from public.invoices where organization_id=p_org),
    'payment_count',(select count(*) from public.payments where organization_id=p_org),
    'expense_count',(select count(*) from public.expenses where organization_id=p_org),
    'overdue_invoice_count',(select count(*) from public.invoices where organization_id=p_org and status='overdue'),
    'accepted_quote_count',(select count(*) from public.quotes where organization_id=p_org and status in ('accepted','converted'))
  );
end;$$;

create or replace function public.analysis_metrics(p_org uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_budget public.budgets%rowtype;v_start date;v_end date;
begin
  perform public.assert_org_access(p_org);
  v_start:=date_trunc('month',current_date)::date;v_end:=(date_trunc('month',current_date)+interval '1 month - 1 day')::date;
  select * into v_budget from public.budgets where organization_id=p_org and period_start<=current_date and period_end>=current_date and scenario='normal' order by period_start desc limit 1;
  return jsonb_build_object(
    'revenue',coalesce((select sum(subtotal) from public.invoices where organization_id=p_org and status not in ('draft','cancelled') and issue_date between v_start and v_end),0),
    'budget_revenue',v_budget.revenue_budget,
    'expenses',coalesce((select sum(amount) from public.expenses where organization_id=p_org and status in ('validated','paid') and expense_date between v_start and v_end),0),
    'budget_expenses',v_budget.expense_budget,
    'receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and status not in ('draft','cancelled','paid')),0),
    'overdue_receivables',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date<current_date and status<>'cancelled'),0),
    'cash_available',coalesce((select sum(balance) from public.financial_accounts where organization_id=p_org and is_active and type in ('bank','cash','mobile_money')),0),
    'expected_receipts_30d',coalesce((select sum(balance_due) from public.invoices where organization_id=p_org and balance_due>0 and due_date between current_date and current_date+30 and status<>'cancelled'),0),
    'obligations_30d',coalesce((select sum(amount-paid_amount) from public.tax_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=current_date+30),0)+coalesce((select sum(amount-paid_amount) from public.social_obligations where organization_id=p_org and status not in ('paid','cancelled') and due_date<=current_date+30),0),
    'unbilled_completed_services',0
  );
end;$$;

create or replace function public.management_financial_statements(p_org uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_assets numeric;v_liabilities numeric;v_revenue numeric;v_expenses numeric;
begin
  perform public.assert_org_access(p_org);
  select coalesce(sum(debit-credit),0) into v_assets from public.journal_entry_lines where organization_id=p_org and (account_key='AR' or account_key like 'TREASURY:%');
  select coalesce(sum(credit-debit),0) into v_liabilities from public.journal_entry_lines where organization_id=p_org and account_key='TAX_PAYABLE';
  select coalesce(sum(credit-debit),0) into v_revenue from public.journal_entry_lines where organization_id=p_org and account_key='SALES_REVENUE';
  select coalesce(sum(debit-credit),0) into v_expenses from public.journal_entry_lines where organization_id=p_org and account_key like 'EXPENSE:%';
  return jsonb_build_object('assets',v_assets,'liabilities',v_liabilities,'equity',v_assets-v_liabilities,'revenue',v_revenue,'expenses',v_expenses);
end;$$;