-- Reject non-MVola wallets in the MVola reimbursement RPC.
CREATE OR REPLACE FUNCTION public.record_mvola_payment_with_reimbursement(p_org uuid, p_invoice uuid, p_account uuid, p_amount numeric, p_paid_at date, p_reference text, p_request_key uuid, p_fee_option text, p_fee_reimbursement numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_payment public.payments%rowtype; v_account public.financial_accounts%rowtype; v_exist numeric; v_entry uuid;
begin
 if p_fee_option not in ('with_fees','without_fees') or p_fee_option is null then raise exception 'Choix des frais invalide'; end if;
 if p_fee_reimbursement is null or p_fee_reimbursement < 0 or round(p_fee_reimbursement,2)<>p_fee_reimbursement then raise exception 'Montant des frais invalide'; end if;
 if (p_fee_option='without_fees' and p_fee_reimbursement<>0) or (p_fee_option='with_fees' and p_fee_reimbursement<=0) then raise exception 'Montant de remboursement incoherent avec le choix des frais'; end if;
 perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'payments.record');
 select * into v_account from public.financial_accounts where id=p_account and organization_id=p_org and type='mobile_money' and lower(trim(name))='mvola' and is_active;
 if not found then raise exception 'Compte Mobile Money requis'; end if;
 v_id:=public.lot1_record_invoice_payment_idempotent(p_org,p_invoice,p_account,p_amount,p_paid_at,'mobile_money',p_reference,p_request_key);
 select * into v_payment from public.payments where id=v_id and organization_id=p_org for update;
 if not found then raise exception 'Paiement introuvable'; end if;
 if v_payment.mvola_withdrawal_fee_option is not null and v_payment.mvola_withdrawal_fee_option<>p_fee_option then raise exception 'Option de frais deja enregistree differente'; end if;
 if v_payment.mvola_fee_reimbursement is not null and v_payment.mvola_fee_reimbursement<>p_fee_reimbursement then raise exception 'Remboursement different pour une transaction deja enregistree'; end if;
 update public.payments set mvola_withdrawal_fee_option=p_fee_option,mvola_fee_reimbursement=p_fee_reimbursement where id=v_id and organization_id=p_org;
 if p_fee_reimbursement=0 then return v_id; end if;
 select amount into v_exist from public.financial_transactions where organization_id=p_org and source_type='mvola_fee_contribution' and source_id=v_id and financial_account_id=p_account for update;
 if found then if v_exist<>p_fee_reimbursement then raise exception 'Complement deja comptabilise avec un montant different'; end if; return v_id; end if;
 insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) values(p_org,p_account,p_paid_at,p_fee_reimbursement,'adjustment','mvola_fee_contribution',v_id,v_payment.reference,'Remboursement client frais MVola - facture '||(select number from public.invoices where id=p_invoice));
 update public.financial_accounts set balance=balance+p_fee_reimbursement,updated_at=now() where id=p_account and organization_id=p_org;
 insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit,status) values(p_org,p_paid_at,v_payment.reference,'Remboursement client frais MVola - qualification fiscale a valider','mvola_fee_contribution',v_id,p_fee_reimbursement,p_fee_reimbursement,'posted') returning id into v_entry;
 insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) values(p_org,v_entry,'TREASURY:'||p_account::text,v_account.name,p_fee_reimbursement,0,p_account),(p_org,v_entry,'471','Remboursements clients frais MVola - a reclasser',0,p_fee_reimbursement,null);
 return v_id;
end; $function$;
