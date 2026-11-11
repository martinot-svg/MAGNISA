create or replace function public.add_quote_line_from_service(p_org uuid,p_quote uuid,p_service uuid,p_quantity numeric,p_discount_pct numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare q public.quotes%rowtype;s public.services%rowtype;v_line uuid;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;v_sort int;
begin
  perform public.assert_org_access(p_org);
  if p_quantity<=0 or p_discount_pct<0 or p_discount_pct>100 then raise exception 'Ligne invalide';end if;
  select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable';end if;
  if q.status not in ('draft','sent','negotiating') then raise exception 'Ce devis n''est plus modifiable';end if;
  select * into s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  select coalesce(max(sort_order),0)+1 into v_sort from public.quote_lines where quote_id=q.id;
  v_gross:=round(p_quantity*s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,q.id,s.id,s.name,p_quantity,s.unit,s.unit_price,p_discount_pct,v_discount,v_taxable,s.tax_rate,v_tax,v_total,v_sort) returning id into v_line;
  update public.quotes set
    subtotal=(select coalesce(sum(taxable_amount),0) from public.quote_lines where quote_id=q.id),
    discount_total=(select coalesce(sum(discount_amount),0) from public.quote_lines where quote_id=q.id),
    tax_total=(select coalesce(sum(tax_amount),0) from public.quote_lines where quote_id=q.id),
    total=(select coalesce(sum(line_total),0) from public.quote_lines where quote_id=q.id),updated_at=now()
  where id=q.id;
  perform public.audit_event(p_org,'quote.line_added','quote',q.id,null,jsonb_build_object('line_id',v_line,'service_id',s.id));
  return v_line;
end;$$;

create or replace function public.add_invoice_line_from_service(p_org uuid,p_invoice uuid,p_service uuid,p_quantity numeric,p_discount_pct numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype;s public.services%rowtype;v_line uuid;v_gross numeric;v_discount numeric;v_taxable numeric;v_tax numeric;v_total numeric;v_sort int;
begin
  perform public.assert_org_access(p_org);
  if p_quantity<=0 or p_discount_pct<0 or p_discount_pct>100 then raise exception 'Ligne invalide';end if;
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable';end if;
  if i.status<>'draft' then raise exception 'Une facture émise n''est plus modifiable librement';end if;
  select * into s from public.services where id=p_service and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  select coalesce(max(sort_order),0)+1 into v_sort from public.invoice_lines where invoice_id=i.id;
  v_gross:=round(p_quantity*s.unit_price,2);v_discount:=round(v_gross*p_discount_pct/100,2);v_taxable:=v_gross-v_discount;v_tax:=round(v_taxable*s.tax_rate/100,2);v_total:=v_taxable+v_tax;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,i.id,s.id,s.name,p_quantity,s.unit,s.unit_price,p_discount_pct,v_discount,v_taxable,s.tax_rate,v_tax,v_total,v_sort) returning id into v_line;
  update public.invoices set
    subtotal=(select coalesce(sum(taxable_amount),0) from public.invoice_lines where invoice_id=i.id),
    discount_total=(select coalesce(sum(discount_amount),0) from public.invoice_lines where invoice_id=i.id),
    tax_total=(select coalesce(sum(tax_amount),0) from public.invoice_lines where invoice_id=i.id),
    total=(select coalesce(sum(line_total),0) from public.invoice_lines where invoice_id=i.id),
    balance_due=(select coalesce(sum(line_total),0) from public.invoice_lines where invoice_id=i.id)-paid_amount,updated_at=now()
  where id=i.id;
  perform public.audit_event(p_org,'invoice.line_added','invoice',i.id,null,jsonb_build_object('line_id',v_line,'service_id',s.id));
  return v_line;
end;$$;

create or replace function public.duplicate_quote(p_org uuid,p_quote uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare q public.quotes%rowtype;v_new uuid;v_number text;
begin
  perform public.assert_org_access(p_org);
  select * into q from public.quotes where id=p_quote and organization_id=p_org;
  if not found then raise exception 'Devis introuvable';end if;
  v_number:=public.next_document_number(p_org,'quote');
  insert into public.quotes(organization_id,customer_id,number,version,status,issue_date,valid_until,subtotal,discount_total,tax_total,total,notes,created_by)
  values(p_org,q.customer_id,v_number,1,'draft',current_date,greatest(current_date+30,q.valid_until),q.subtotal,q.discount_total,q.tax_total,q.total,q.notes,auth.uid()) returning id into v_new;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_new,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order from public.quote_lines where quote_id=q.id;
  perform public.audit_event(p_org,'quote.duplicated','quote',v_new,null,jsonb_build_object('source_quote_id',q.id,'number',v_number));
  return v_new;
end;$$;

create or replace function public.cancel_invoice(p_org uuid,p_invoice uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare i public.invoices%rowtype;v_entry uuid;
begin
  perform public.assert_org_access(p_org);
  if length(trim(p_reason))<3 then raise exception 'Motif obligatoire';end if;
  select * into i from public.invoices where id=p_invoice and organization_id=p_org for update;
  if not found then raise exception 'Facture introuvable';end if;
  if i.status='cancelled' then raise exception 'Facture déjà annulée';end if;
  if i.paid_amount>0 then raise exception 'Une facture déjà payée doit être corrigée par avoir/remboursement, pas annulée directement';end if;
  if i.status<>'draft' then
    insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
    values(p_org,current_date,'ANN-'||i.number,'Annulation facture '||i.number,'invoice_cancellation',i.id,i.total,i.total) returning id into v_entry;
    insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id) values
      (p_org,v_entry,'SALES_REVENUE','Annulation chiffre d''affaires',i.subtotal,0,i.customer_id),
      (p_org,v_entry,'AR','Annulation créance client',0,i.total,i.customer_id);
    if i.tax_total>0 then insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,customer_id)
      values(p_org,v_entry,'TAX_PAYABLE','Annulation taxe collectée',i.tax_total,0,i.customer_id);end if;
  end if;
  update public.invoices set status='cancelled',balance_due=0,cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now() where id=i.id;
  perform public.audit_event(p_org,'invoice.cancelled','invoice',i.id,jsonb_build_object('status',i.status),jsonb_build_object('status','cancelled','reason',p_reason));
end;$$;

create or replace function public.transfer_funds(p_org uuid,p_from uuid,p_to uuid,p_amount numeric,p_date date,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a_from public.financial_accounts%rowtype;a_to public.financial_accounts%rowtype;v_transfer uuid:=gen_random_uuid();v_entry uuid;
begin
  perform public.assert_org_access(p_org);
  if p_from=p_to then raise exception 'Les comptes doivent être différents';end if;
  if p_amount<=0 then raise exception 'Montant invalide';end if;
  select * into a_from from public.financial_accounts where id=p_from and organization_id=p_org and is_active for update;
  select * into a_to from public.financial_accounts where id=p_to and organization_id=p_org and is_active for update;
  if a_from.id is null or a_to.id is null then raise exception 'Compte invalide';end if;
  update public.financial_accounts set balance=balance-p_amount,updated_at=now() where id=a_from.id;
  update public.financial_accounts set balance=balance+p_amount,updated_at=now() where id=a_to.id;
  insert into public.financial_transactions(organization_id,financial_account_id,transaction_date,amount,kind,source_type,source_id,reference,description) values
    (p_org,a_from.id,p_date,-p_amount,'transfer_out','transfer',v_transfer,p_reference,'Transfert vers '||a_to.name),
    (p_org,a_to.id,p_date,p_amount,'transfer_in','transfer',v_transfer,p_reference,'Transfert depuis '||a_from.name);
  insert into public.journal_entries(organization_id,entry_date,reference,description,source_type,source_id,total_debit,total_credit)
  values(p_org,p_date,coalesce(nullif(trim(p_reference),''),'TRF-'||left(v_transfer::text,8)),'Transfert interne','transfer',v_transfer,p_amount,p_amount) returning id into v_entry;
  insert into public.journal_entry_lines(organization_id,journal_entry_id,account_key,account_label,debit,credit,financial_account_id) values
    (p_org,v_entry,'TREASURY:'||a_to.id::text,a_to.name,p_amount,0,a_to.id),
    (p_org,v_entry,'TREASURY:'||a_from.id::text,a_from.name,0,p_amount,a_from.id);
  perform public.audit_event(p_org,'treasury.transfer','transfer',v_transfer,null,jsonb_build_object('from',a_from.id,'to',a_to.id,'amount',p_amount));
  return v_transfer;
end;$$;