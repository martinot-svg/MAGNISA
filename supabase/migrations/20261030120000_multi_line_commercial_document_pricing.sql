-- Multi-line commercial documents with server-validated unit-price snapshots.
-- Prices are copied into document lines at creation; later catalogue changes do not alter issued documents.

create or replace function public.create_quote_draft(
  p_org uuid,
  p_customer uuid,
  p_valid_until date,
  p_lines jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_quote uuid;
  v_number text;
  r jsonb;
  s public.services%rowtype;
  q numeric;
  d numeric;
  unit_price numeric;
  gross numeric;
  disc numeric;
  taxable numeric;
  tax numeric;
  total numeric;
  v_sub numeric:=0;
  v_disc numeric:=0;
  v_tax numeric:=0;
  v_total numeric:=0;
  v_sort integer:=1;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'quotes.create');
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then
    raise exception 'Client invalide';
  end if;
  if p_valid_until is null or p_valid_until<current_date then
    raise exception 'Date de validité invalide';
  end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then
    raise exception 'Le devis doit contenir entre 1 et 100 prestations';
  end if;

  for r in select value from jsonb_array_elements(p_lines) loop
    q:=coalesce((r->>'quantity')::numeric,0);
    d:=coalesce((r->>'discount_pct')::numeric,0);
    if q<=0 or d<0 or d>100 or not (r ? 'unit_price') then
      raise exception 'Ligne de devis invalide';
    end if;
    unit_price:=(r->>'unit_price')::numeric;
    if unit_price<0 then raise exception 'Prix unitaire invalide'; end if;
    select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
    if not found then raise exception 'Prestation invalide'; end if;
    gross:=round(q*unit_price,2);
    disc:=round(gross*d/100,2);
    taxable:=gross-disc;
    tax:=round(taxable*s.tax_rate/100,2);
    total:=taxable+tax;
    v_sub:=v_sub+taxable; v_disc:=v_disc+disc; v_tax:=v_tax+tax; v_total:=v_total+total;
  end loop;

  v_number:=public.next_document_number(p_org,'quote');
  insert into public.quotes(organization_id,customer_id,number,valid_until,subtotal,discount_total,tax_total,total,created_by)
  values(p_org,p_customer,v_number,p_valid_until,v_sub,v_disc,v_tax,v_total,auth.uid())
  returning id into v_quote;

  for r in select value from jsonb_array_elements(p_lines) loop
    q:=(r->>'quantity')::numeric;
    d:=coalesce((r->>'discount_pct')::numeric,0);
    unit_price:=(r->>'unit_price')::numeric;
    select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
    gross:=round(q*unit_price,2);
    disc:=round(gross*d/100,2);
    taxable:=gross-disc;
    tax:=round(taxable*s.tax_rate/100,2);
    total:=taxable+tax;
    insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
    values(p_org,v_quote,s.id,s.name,q,s.unit,unit_price,d,disc,taxable,s.tax_rate,tax,total,v_sort);
    v_sort:=v_sort+1;
  end loop;

  perform public.audit_event(p_org,'quote.created','quote',v_quote,null,jsonb_build_object('number',v_number,'lines',jsonb_array_length(p_lines),'total',v_total));
  return v_quote;
end;
$function$;

-- Extend invoice creation to persist the validated unit price selected in the draft form.
create or replace function public.create_invoice_draft(
  p_org uuid,
  p_customer uuid,
  p_due_date date,
  p_lines jsonb,
  p_order uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_invoice uuid;
  v_number text;
  r jsonb;
  s public.services%rowtype;
  q numeric;
  d numeric;
  unit_price numeric;
  gross numeric;
  disc numeric;
  taxable numeric;
  tax numeric;
  total numeric;
  v_sub numeric:=0;
  v_disc numeric:=0;
  v_tax numeric:=0;
  v_total numeric:=0;
  v_sort integer:=1;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.create');
  if p_due_date is null or p_due_date<current_date then raise exception 'Échéance invalide'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then
    raise exception 'La facture doit contenir entre 1 et 100 prestations';
  end if;
  if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then
    raise exception 'Client invalide';
  end if;
  if p_order is not null then
    if not exists(select 1 from public.orders where id=p_order and organization_id=p_org and status in ('confirmed','in_progress','completed')) then
      raise exception 'Commande invalide';
    end if;
    if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org and status<>'cancelled') then
      raise exception 'Cette commande possède déjà une facture active';
    end if;
  end if;

  for r in select value from jsonb_array_elements(p_lines) loop
    q:=coalesce((r->>'quantity')::numeric,0);
    d:=coalesce((r->>'discount_pct')::numeric,0);
    if q<=0 or d<0 or d>100 or not (r ? 'unit_price') then raise exception 'Ligne de facture invalide'; end if;
    unit_price:=(r->>'unit_price')::numeric;
    if unit_price<0 then raise exception 'Prix unitaire invalide'; end if;
    select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
    if not found then raise exception 'Prestation invalide'; end if;
    gross:=round(q*unit_price,2);
    disc:=round(gross*d/100,2);
    taxable:=gross-disc;
    tax:=round(taxable*s.tax_rate/100,2);
    total:=taxable+tax;
    v_sub:=v_sub+taxable; v_disc:=v_disc+disc; v_tax:=v_tax+tax; v_total:=v_total+total;
  end loop;

  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
  values(p_org,p_customer,p_order,v_number,'draft',current_date,p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid())
  returning id into v_invoice;

  for r in select value from jsonb_array_elements(p_lines) loop
    q:=(r->>'quantity')::numeric;
    d:=coalesce((r->>'discount_pct')::numeric,0);
    unit_price:=(r->>'unit_price')::numeric;
    select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
    gross:=round(q*unit_price,2);
    disc:=round(gross*d/100,2);
    taxable:=gross-disc;
    tax:=round(taxable*s.tax_rate/100,2);
    total:=taxable+tax;
    insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
    values(p_org,v_invoice,s.id,s.name,q,s.unit,unit_price,d,disc,taxable,s.tax_rate,tax,total,v_sort);
    v_sort:=v_sort+1;
  end loop;

  perform public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,null,jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));
  return v_invoice;
end;
$function$;

revoke all on function public.create_quote_draft(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.create_quote_draft(uuid,uuid,date,jsonb) to authenticated;
revoke all on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) to authenticated;

-- Editing quantity or discount must preserve the unit price and tax rate
-- captured on the invoice line, not silently reload today's catalogue values.
create or replace function public.update_invoice_line(
 p_org uuid,p_line uuid,p_quantity numeric,p_discount_pct numeric
) returns void
language plpgsql
security definer
set search_path=public
as $function$
declare
 l public.invoice_lines%rowtype;
 gross numeric;
 disc numeric;
 taxable numeric;
 tax numeric;
 total numeric;
 inv uuid;
begin
 perform public.assert_org_access(p_org);
 perform public.assert_org_permission(p_org,'invoices.create');
 if p_quantity is null or p_quantity<=0 then raise exception 'Quantité invalide'; end if;
 if p_discount_pct is null or p_discount_pct<0 or p_discount_pct>100 then raise exception 'Remise invalide'; end if;
 select * into l from public.invoice_lines where id=p_line and organization_id=p_org for update;
 if not found then raise exception 'Ligne de facture introuvable'; end if;
 inv:=l.invoice_id;
 if not exists(select 1 from public.invoices where id=inv and organization_id=p_org and status='draft') then
   raise exception 'Seule une facture brouillon peut être modifiée';
 end if;
 gross:=round(p_quantity*l.unit_price,2);
 disc:=round(gross*p_discount_pct/100,2);
 taxable:=gross-disc;
 tax:=round(taxable*l.tax_rate/100,2);
 total:=taxable+tax;
 update public.invoice_lines
 set quantity=p_quantity,discount_pct=p_discount_pct,discount_amount=disc,
     taxable_amount=taxable,tax_amount=tax,line_total=total
 where id=l.id and organization_id=p_org;
 update public.invoices i
 set subtotal=x.subtotal,discount_total=x.discount_total,tax_total=x.tax_total,
     total=x.total,balance_due=x.total-i.paid_amount,updated_at=now()
 from (select invoice_id,sum(taxable_amount) subtotal,sum(discount_amount) discount_total,
              sum(tax_amount) tax_total,sum(line_total) total
       from public.invoice_lines where invoice_id=inv group by invoice_id) x
 where i.id=inv and i.organization_id=p_org;
end;
$function$;
