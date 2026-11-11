alter table public.payments
 add column if not exists mvola_withdrawal_fee_option text
 constraint payments_mvola_withdrawal_fee_option_check
 check (mvola_withdrawal_fee_option in ('with_fees','without_fees'));

create or replace function public.record_mvola_invoice_payment_with_fee_option(
 p_org uuid, p_invoice uuid, p_account uuid, p_amount numeric,
 p_paid_at date, p_method text, p_reference text, p_request_key uuid,
 p_fee_option text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_existing text;
begin
 if p_method <> 'mobile_money' then
  raise exception 'Le mode de paiement doit être Mobile Money';
 end if;
 if p_fee_option is null or p_fee_option not in ('with_fees','without_fees') then
  raise exception 'Choix des frais MVola invalide';
 end if;
 v_id := public.lot1_record_invoice_payment_idempotent(
   p_org,p_invoice,p_account,p_amount,p_paid_at,p_method,p_reference,p_request_key
 );
 select mvola_withdrawal_fee_option into v_existing
 from public.payments where id=v_id and organization_id=p_org for update;
 if not found then raise exception 'Paiement introuvable'; end if;
 if v_existing is not null and v_existing <> p_fee_option then
  raise exception 'Choix des frais différent pour ce paiement déjà enregistré';
 end if;
 update public.payments
 set mvola_withdrawal_fee_option=p_fee_option
 where id=v_id and organization_id=p_org;
 return v_id;
end; $$;
revoke all on function public.record_mvola_invoice_payment_with_fee_option(uuid,uuid,uuid,numeric,date,text,text,uuid,text) from public,anon;
grant execute on function public.record_mvola_invoice_payment_with_fee_option(uuid,uuid,uuid,numeric,date,text,text,uuid,text) to authenticated;