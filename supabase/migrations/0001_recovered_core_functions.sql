-- Core RPCs required by the historical finance hardening migration.
-- Later migrations replace these definitions with the production-hardened versions.

create table if not exists public.cash_receipt_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_year integer not null check(receipt_year between 2000 and 9999),
  next_value bigint not null default 1 check(next_value > 0),
  primary key(organization_id,receipt_year)
);
create table if not exists public.cash_receipt_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_key uuid not null,
  receipt_year integer not null check(receipt_year between 2000 and 9999),
  reference text not null,
  reserved_by uuid not null references auth.users(id),
  payment_id uuid references public.payments(id),
  created_at timestamptz not null default now(),
  unique(organization_id,request_key),
  unique(organization_id,reference)
);

create or replace function public.next_document_number(p_org uuid,p_type text)
returns text language plpgsql security definer set search_path=public as $$
declare v_prefix text; v_next bigint; v_padding int;
begin
  perform public.assert_org_access(p_org);
  select prefix,next_value,padding into v_prefix,v_next,v_padding from public.number_sequences where organization_id=p_org and document_type=p_type for update;
  if not found then
    insert into public.number_sequences(organization_id,document_type,prefix,next_value,padding) values(p_org,p_type,upper(left(p_type,3))||'-',2,5) returning prefix,next_value,padding into v_prefix,v_next,v_padding;
    return v_prefix||lpad('1',v_padding,'0');
  end if;
  update public.number_sequences set next_value=v_next+1,updated_at=now() where organization_id=p_org and document_type=p_type;
  return v_prefix||lpad(v_next::text,v_padding,'0');
end;
$$;

create or replace function public.record_expense(p_org uuid,p_description text,p_amount numeric,p_date date,p_account uuid,p_category text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.financial_accounts%rowtype; v_expense uuid; v_entry uuid; v_number text;
begin
  perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'expenses.record');
  if p_amount is null or p_amount<=0 then raise exception 'Montant invalide'; end if;
  if length(trim(coalesce(p_description,'')))<2 then raise exception 'Description requise'; end if;
  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide'; end if;
  v_number:=public.next_document_number(p_org,'expense');
  insert into public.expenses(organization_id,financial_account_id,description,category,amount,expense_date,status,created_by)
  values(p_org,a.id,trim(p_description),trim(coalesce(p_category,'Autres')),p_amount,p_date,'paid',auth.uid()) returning id into v_expense;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,a.id,p_date,-p_amount,'expense','expense',v_expense,v_number,p_description);
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_date,v_number,p_description,'expense',v_expense,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
  values(p_org,v_entry,'EXPENSE:'||lower(regexp_replace(trim(coalesce(p_category,'Autres')),'[^a-zA-Z0-9]+','_','g')),trim(coalesce(p_category,'Autres')),p_amount,0,null),
         (p_org,v_entry,'TREASURY:'||a.id::text,a.name,0,p_amount,a.id);
  perform public.audit_event(p_org,'expense.recorded','expense',v_expense,null,jsonb_build_object('amount',p_amount,'category',p_category));
  return v_expense;
end;
$$;

create or replace function public.record_invoice_payment(p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,p_method text,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype; a public.financial_accounts%rowtype; v_payment uuid; v_entry uuid; v_new_paid numeric; v_balance numeric; v_status text; v_reference text;
begin
  perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'payments.record');
  if p_amount is null or p_amount<=0 then raise exception 'Montant invalide'; end if;
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if i.status in ('draft','cancelled') then raise exception 'Paiement impossible sur cette facture'; end if;
  if p_amount>i.balance_due then raise exception 'Le paiement dépasse le solde restant'; end if;
  select * into a from public.financial_accounts where id=p_account and organization_id=p_org and is_active for update;
  if not found then raise exception 'Compte financier invalide'; end if;
  v_reference:=coalesce(nullif(trim(p_reference),''),public.next_document_number(p_org,'payment'));
  insert into public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
  values(p_org,i.id,i.customer_id,a.id,v_reference,p_amount,p_method,'confirmed',p_paid_at,auth.uid()) returning id into v_payment;
  update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,a.id,p_paid_at,p_amount,'customer_payment','payment',v_payment,v_reference,'Paiement facture '||i.number);
  v_new_paid:=i.paid_amount+p_amount; v_balance:=i.total-v_new_paid;
  v_status:=case when v_balance=0 then 'paid' when i.due_date is not null and i.due_date<current_date then 'overdue' else 'partially_paid' end;
  update public.invoices set paid_amount=v_new_paid,balance_due=v_balance,status=v_status,updated_at=now() where id=i.id;
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_paid_at,v_reference,'Encaissement '||i.number,'payment',v_payment,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id)
  values(p_org,v_entry,'TREASURY:'||a.id::text,a.name,p_amount,0,a.id,i.customer_id),(p_org,v_entry,'AR','Créances clients',0,p_amount,null,i.customer_id);
  perform public.audit_event(p_org,'payment.recorded','payment',v_payment,null,jsonb_build_object('invoice_id',i.id,'amount',p_amount,'account_id',a.id,'reference',v_reference));
  return v_payment;
end;
$$;

create or replace function public.transfer_funds(p_org uuid,p_from uuid,p_to uuid,p_amount numeric,p_date date,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a_from public.financial_accounts%rowtype; a_to public.financial_accounts%rowtype; v_transfer uuid:=gen_random_uuid(); v_entry uuid;
begin
  perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'treasury.transfer');
  if p_from=p_to or p_amount<=0 then raise exception 'Transfert invalide'; end if;
  perform id from public.financial_accounts where organization_id=p_org and is_active and id in (p_from,p_to) order by id for update;
  select * into a_from from public.financial_accounts where id=p_from and organization_id=p_org and is_active;
  select * into a_to from public.financial_accounts where id=p_to and organization_id=p_org and is_active;
  if a_from.id is null or a_to.id is null then raise exception 'Compte invalide'; end if;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a_from.id;
  update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a_to.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
  values(p_org,a_from.id,p_date,-p_amount,'transfer_out','transfer',v_transfer,p_reference,'Transfert vers '||a_to.name),(p_org,a_to.id,p_date,p_amount,'transfer_in','transfer',v_transfer,p_reference,'Transfert depuis '||a_from.name);
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_date,coalesce(nullif(trim(p_reference),''),'TRF-'||left(v_transfer::text,8)),'Transfert interne','transfer',v_transfer,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id)
  values(p_org,v_entry,'TREASURY:'||a_to.id::text,a_to.name,p_amount,0,a_to.id),(p_org,v_entry,'TREASURY:'||a_from.id::text,a_from.name,0,p_amount,a_from.id);
  perform public.audit_event(p_org,'treasury.transfer','transfer',v_transfer,null,jsonb_build_object('from',a_from.id,'to',a_to.id,'amount',p_amount));
  return v_transfer;
end;
$$;
