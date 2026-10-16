-- Cash receipts receive a server-generated, per-company/per-year sequence.
-- Existing payment references are never modified.
create table if not exists public.cash_receipt_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_year integer not null check (receipt_year between 2000 and 9999),
  next_value bigint not null default 1 check (next_value > 0),
  primary key (organization_id, receipt_year)
);
alter table public.cash_receipt_sequences enable row level security;
revoke all on public.cash_receipt_sequences from public,anon,authenticated;
create unique index if not exists payments_cash_receipt_reference_unique
on public.payments(organization_id,reference)
where method='cash' and reference like 'REC-%';

create or replace function public.record_invoice_payment(
 p_org uuid,p_invoice uuid,p_account uuid,p_amount numeric,p_paid_at date,
 p_method text,p_reference text default null
) returns uuid language plpgsql security definer set search_path=public as $function$
declare
 i public.invoices%rowtype;
 a public.financial_accounts%rowtype;
 v_payment uuid;v_entry uuid;v_new_paid numeric;v_balance numeric;v_status text;
 v_number text;v_reference text;v_receipt_sequence bigint;v_year integer;
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
   insert into public.cash_receipt_sequences(organization_id,receipt_year,next_value)
   values(p_org,v_year,2)
   on conflict(organization_id,receipt_year) do update
   set next_value=public.cash_receipt_sequences.next_value+1
   returning next_value-1 into v_receipt_sequence;
   v_reference:='REC-'||v_year::text||'-'||lpad(v_receipt_sequence::text,5,'0');
 else
   v_reference:=coalesce(nullif(trim(p_reference),''),v_number);
 end if;
 insert into public.payments(organization_id,invoice_id,customer_id,financial_account_id,reference,amount,method,status,paid_at,created_by)
 values(p_org,i.id,i.customer_id,a.id,v_reference,p_amount,p_method,'confirmed',p_paid_at,auth.uid())
 returning id into v_payment;
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
