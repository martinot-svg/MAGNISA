alter table public.number_sequences drop constraint if exists number_sequences_document_type_check;
alter table public.number_sequences add constraint number_sequences_document_type_check
  check(document_type in ('quote','order','delivery_note','invoice','credit_note','receipt','payment','expense'));

insert into public.number_sequences(organization_id,document_type,prefix,next_value,padding)
select id,'order','CMD-',1,5 from public.organizations
on conflict(organization_id,document_type) do nothing;
insert into public.number_sequences(organization_id,document_type,prefix,next_value,padding)
select id,'credit_note','AV-',1,5 from public.organizations
on conflict(organization_id,document_type) do nothing;

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
    (v_org,'quote','DEV-',1,5),(v_org,'order','CMD-',1,5),(v_org,'invoice','FAC-',1,5),(v_org,'credit_note','AV-',1,5),(v_org,'payment','PAY-',1,5),(v_org,'expense','DEP-',1,5);
  perform public.audit_event(v_org,'organization.created','organization',v_org,null,jsonb_build_object('name',p_name,'currency',p_currency));
  return v_org;
end;$$;

create or replace function public.convert_quote_to_order(p_org uuid,p_quote uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare q public.quotes%rowtype;v_order uuid;v_number text;
begin
  perform public.assert_org_access(p_org);
  select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if q.status <> 'accepted' then raise exception 'Seul un devis accepté peut devenir une commande'; end if;
  if exists(select 1 from public.orders where quote_id=p_quote and organization_id=p_org) then raise exception 'Ce devis possède déjà une commande'; end if;
  v_number:=public.next_document_number(p_org,'order');
  insert into public.orders(organization_id,customer_id,quote_id,number,status,order_date,subtotal,tax_total,total,notes,created_by)
  values(p_org,q.customer_id,q.id,v_number,'confirmed',current_date,q.subtotal,q.tax_total,q.total,q.notes,auth.uid()) returning id into v_order;
  insert into public.order_lines(organization_id,order_id,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order)
  select organization_id,v_order,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order from public.quote_lines where quote_id=q.id;
  update public.quotes set status='converted',updated_at=now() where id=q.id;
  perform public.audit_event(p_org,'quote.converted_to_order','quote',q.id,jsonb_build_object('status','accepted'),jsonb_build_object('status','converted','order_id',v_order));
  return v_order;
end;$$;

create or replace function public.convert_order_to_invoice(p_org uuid,p_order uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype;v_invoice uuid;v_number text;v_days int;
begin
  perform public.assert_org_access(p_org);
  select * into o from public.orders where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable';end if;
  if o.status not in ('confirmed','in_progress','completed') then raise exception 'Statut de commande incompatible'; end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org) then raise exception 'Cette commande possède déjà une facture'; end if;
  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,o.customer_id,o.quote_id,o.id,v_number,'draft',current_date,current_date+coalesce(v_days,30),o.subtotal,0,o.tax_total,o.total,0,o.total,o.notes,auth.uid()) returning id into v_invoice;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_invoice,service_id,description,quantity,unit,unit_price,0,0,round(quantity*unit_price,2),tax_rate,round((quantity*unit_price)*tax_rate/100,2),line_total,sort_order from public.order_lines where order_id=o.id;
  perform public.audit_event(p_org,'order.converted_to_invoice','order',o.id,null,jsonb_build_object('invoice_id',v_invoice));
  return v_invoice;
end;$$;

create or replace function public.record_supplier_payment(p_org uuid,p_supplier_invoice uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare si public.supplier_invoices%rowtype;v_id uuid;v_new_paid numeric;v_new_balance numeric;
begin
  perform public.assert_org_access(p_org);
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  select * into si from public.supplier_invoices where id=p_supplier_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture fournisseur introuvable';end if;
  if si.status='cancelled' then raise exception 'Facture fournisseur annulée';end if;
  if p_amount>si.balance_due then raise exception 'Le paiement dépasse le solde dû';end if;
  if not exists(select 1 from public.financial_accounts where id=p_account and organization_id=p_org and is_active) then raise exception 'Compte financier invalide';end if;
  insert into public.supplier_payments(organization_id,supplier_invoice_id,supplier_id,financial_account_id,amount,payment_date,reference,method,created_by)
  values(p_org,si.id,si.supplier_id,p_account,p_amount,p_date,p_reference,p_method,auth.uid()) returning id into v_id;
  v_new_paid:=si.paid_amount+p_amount;v_new_balance:=greatest(si.total-v_new_paid,0);
  update public.supplier_invoices set paid_amount=v_new_paid,balance_due=v_new_balance,status=case when v_new_balance=0 then 'paid' else 'partially_paid' end,updated_at=now() where id=si.id;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=p_account;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,p_account,p_date,-p_amount,'expense','supplier_payment',v_id,p_reference,'Règlement fournisseur');
  perform public.audit_event(p_org,'supplier_payment.recorded','supplier_payment',v_id,null,jsonb_build_object('supplier_invoice_id',si.id,'amount',p_amount));
  return v_id;
end;$$;

create or replace function public.record_payroll_payment(p_org uuid,p_payslip uuid,p_account uuid,p_amount numeric,p_method text,p_date date,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare ps public.payslips%rowtype;v_id uuid;v_new_paid numeric;
begin
  perform public.assert_org_access(p_org);
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  select * into ps from public.payslips where id=p_payslip and organization_id=p_org for update;
  if not found then raise exception 'Bulletin introuvable';end if;
  if ps.status not in ('validated','partially_paid') then raise exception 'Le bulletin doit être validé avant paiement';end if;
  if ps.paid_amount+p_amount>ps.net_pay then raise exception 'Le paiement dépasse le net à payer';end if;
  if not exists(select 1 from public.financial_accounts where id=p_account and organization_id=p_org and is_active) then raise exception 'Compte financier invalide';end if;
  insert into public.payroll_payments(organization_id,payslip_id,employee_id,financial_account_id,amount,payment_date,method,reference,created_by)
  values(p_org,ps.id,ps.employee_id,p_account,p_amount,p_date,p_method,p_reference,auth.uid()) returning id into v_id;
  v_new_paid:=ps.paid_amount+p_amount;
  update public.payslips set paid_amount=v_new_paid,status=case when v_new_paid=net_pay then 'paid' else 'partially_paid' end,updated_at=now() where id=ps.id;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=p_account;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,p_account,p_date,-p_amount,'expense','payroll_payment',v_id,p_reference,'Paiement salaire');
  perform public.audit_event(p_org,'payroll_payment.recorded','payroll_payment',v_id,null,jsonb_build_object('payslip_id',ps.id,'amount',p_amount));
  return v_id;
end;$$;