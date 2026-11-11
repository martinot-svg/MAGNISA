-- Reserve real cash receipt numbers before submission. Existing receipt references unchanged.
create table if not exists public.cash_receipt_reservations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 request_key uuid not null,
 receipt_year integer not null check(receipt_year between 2000 and 9999),
 reference text not null,
 reserved_by uuid not null,
 payment_id uuid references public.payments(id),
 created_at timestamptz not null default now(),
 unique(organization_id,request_key),
 unique(organization_id,reference)
);
create index if not exists cash_receipt_reservations_payment_idx
on public.cash_receipt_reservations(payment_id) where payment_id is not null;
alter table public.cash_receipt_reservations enable row level security;
revoke all on public.cash_receipt_reservations from public,anon,authenticated;

create or replace function public.reserve_cash_receipt_reference(
 p_org uuid,p_request_key uuid,p_paid_at date
) returns text language plpgsql security definer set search_path=public as $reserve$
declare v_existing public.cash_receipt_reservations%rowtype;
 v_year integer;v_seq bigint;v_reference text;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'payments.record');
 if p_request_key is null or p_paid_at is null then
   raise exception 'Clé et date obligatoires';
 end if;
 v_year:=extract(year from p_paid_at)::integer;
 -- Lock per organization / request key to prevent concurrent double reservations.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_request_key::text,0));
 select * into v_existing from public.cash_receipt_reservations
 where organization_id=p_org and request_key=p_request_key;
 if found then
  if v_existing.receipt_year<>v_year or v_existing.reserved_by is distinct from auth.uid()
   or v_existing.payment_id is not null then
    raise exception 'Réservation de reçu incompatible ou déjà utilisée';
  end if;
  return v_existing.reference;
 end if;
 insert into public.cash_receipt_sequences(organization_id,receipt_year,next_value)
 values(p_org,v_year,2)
 on conflict(organization_id,receipt_year) do update
 set next_value=public.cash_receipt_sequences.next_value+1
 returning next_value-1 into v_seq;
 v_reference:='REC-'||v_year::text||'-'||lpad(v_seq::text,5,'0');
 insert into public.cash_receipt_reservations
 (organization_id,request_key,receipt_year,reference,reserved_by)
 values(p_org,p_request_key,v_year,v_reference,auth.uid());
 return v_reference;
end;$reserve$;
revoke all on function public.reserve_cash_receipt_reference(uuid,uuid,date) from public,anon;
grant execute on function public.reserve_cash_receipt_reference(uuid,uuid,date) to authenticated;

create or replace function public.record_invoice_payment(
 p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,
 p_method text,p_reference text default null
) returns uuid language plpgsql security definer set search_path=public as $function$
declare
 i public.invoices%rowtype;
 a public.financial_accounts%rowtype;
 v_payment uuid;v_entry uuid;v_new_paid numeric;v_balance numeric;v_status text;
 v_number text;v_reference text;v_receipt_sequence bigint;v_year integer;v_reservation public.cash_receipt_reservations%rowtype;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'payments.record');
 if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide'; end if;
 if p_paid_at is null then raise exception 'Date de paiement obligatoire'; end if;
 if p_method not in ('bank_transfer','cash','mobile_money','cheque','card','other') then
   raise exception 'Mode de paiement invalide';
 end if;
 select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
 if not found then raise exception 'Facture introuvable'; end if;
 if i.status in ('draft','cancelled') then raise exception 'Paiement impossible sur cette facture'; end if;
 if p_amount>i.balance_due then raise exception 'Le paiement dépasse le solde restant'; end if;
 select * into a from public.financial_accounts
 where id=p_account and organization_id=p_org and is_active for update;
 if not found then raise exception 'Compte financier invalide'; end if;
 if p_method='cheque' and a.type<>'cheque_clearing' then
   raise exception 'Un chèque reçu doit aller dans Chèques à encaisser';
 end if;
 if p_method='cash' and a.type<>'cash' then
   raise exception 'Un paiement en espèces doit aller dans un compte Caisse';
 end if;
 v_number:=public.next_document_number(p_org,'payment');
 if p_method='cash' then
   v_year:=extract(year from p_paid_at)::integer;
   if nullif(trim(p_reference),'') is not null then
     select * into v_reservation
     from public.cash_receipt_reservations
     where organization_id=p_org and reference=trim(p_reference)
       and receipt_year=v_year and reserved_by=auth.uid()
       and payment_id is null for update;
     if not found then raise exception 'Référence de caisse non réservée ou déjà utilisée'; end if;
     v_reference:=v_reservation.reference;
   else
     insert into public.cash_receipt_sequences(organization_id,receipt_year,next_value)
     values(p_org,v_year,2)
     on conflict(organization_id,receipt_year) do update
     set next_value=public.cash_receipt_sequences.next_value+1
     returning next_value-1 into v_receipt_sequence;
     v_reference:='REC-'||v_year::text||'-'||lpad(v_receipt_sequence::text,5,'0');
   end if;
 else
   v_reference:=coalesce(nullif(trim(p_reference),''),v_number);
 end if;
 insert into public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
 values(p_org,i.id,i.customer_id,a.id,v_reference,p_amount,p_method,'confirmed',p_paid_at,auth.uid())
 returning id into v_payment;
 if p_method='cash' and v_reservation.id is not null then
    update public.cash_receipt_reservations
       set payment_id=v_payment
     where id=v_reservation.id and payment_id is null;
 end if;
 update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a.id;
 insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description)
 values(p_org,a.id,p_paid_at,p_amount,'customer_payment','payment',v_payment,v_reference,'Paiement facture '||i.number);
 v_new_paid:=i.paid_amount+p_amount; v_balance:=i.total-v_new_paid;
 v_status:=case when v_balance=0 then 'paid'
 when i.due_date is not null and i.due_date<current_date then 'overdue'
 else 'partially_paid' end;
 update public.invoices set paid_amount=v_new_paid,balance_due=v_balance,status=v_status,updated_at=now()
 where id=i.id;
 insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
 values(p_org,p_paid_at,v_reference,'Encaissement '||i.number,'payment',v_payment,p_amount,p_amount)
 returning id into v_entry;
 insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id,customer_id)
 values
 (p_org,v_entry,'TREASURY:'||a.id::text,a.name,p_amount,0,a.id,i.customer_id),
 (p_org,v_entry,'AR','Créances clients',0,p_amount,null,i.customer_id);
 perform public.audit_event(p_org,'payment.recorded','payment',v_payment,null,
 jsonb_build_object('invoice_id',i.id,'amount',p_amount,'account_id',a.id,'reference',v_reference));
 return v_payment;
end;$function$;

revoke execute on function public.record_invoice_payment(uuid,uuid,uuid,numeric,date,text,text) from public,anon,authenticated;
