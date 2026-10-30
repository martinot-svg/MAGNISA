-- Keep quote line snapshots intact when accepted quotes become orders and invoices.
alter table public.order_lines add column if not exists discount_pct numeric(7,4) not null default 0;
alter table public.order_lines add column if not exists discount_amount numeric(18,2) not null default 0;
alter table public.order_lines add column if not exists taxable_amount numeric(18,2) not null default 0;
do $constraints$
begin
 if not exists(select 1 from pg_constraint where conname='order_lines_discount_pct_check' and conrelid='public.order_lines'::regclass) then
  alter table public.order_lines add constraint order_lines_discount_pct_check check(discount_pct between 0 and 100);
 end if;
 if not exists(select 1 from pg_constraint where conname='order_lines_discount_amount_check' and conrelid='public.order_lines'::regclass) then
  alter table public.order_lines add constraint order_lines_discount_amount_check check(discount_amount>=0);
 end if;
 if not exists(select 1 from pg_constraint where conname='order_lines_taxable_amount_check' and conrelid='public.order_lines'::regclass) then
  alter table public.order_lines add constraint order_lines_taxable_amount_check check(taxable_amount>=0);
 end if;
end
$constraints$;

-- Backfill order lines that were previously copied from a quote.
update public.order_lines ol
set discount_pct=(select ql.discount_pct from public.orders o join public.quote_lines ql on ql.quote_id=o.quote_id and ql.organization_id=ol.organization_id and ql.sort_order=ol.sort_order where o.id=ol.order_id and o.organization_id=ol.organization_id),
    discount_amount=(select ql.discount_amount from public.orders o join public.quote_lines ql on ql.quote_id=o.quote_id and ql.organization_id=ol.organization_id and ql.sort_order=ol.sort_order where o.id=ol.order_id and o.organization_id=ol.organization_id),
    taxable_amount=(select ql.taxable_amount from public.orders o join public.quote_lines ql on ql.quote_id=o.quote_id and ql.organization_id=ol.organization_id and ql.sort_order=ol.sort_order where o.id=ol.order_id and o.organization_id=ol.organization_id)
where exists(select 1 from public.orders o join public.quote_lines ql on ql.quote_id=o.quote_id and ql.organization_id=ol.organization_id and ql.sort_order=ol.sort_order where o.id=ol.order_id and o.organization_id=ol.organization_id);

create or replace function public.convert_quote_to_order(p_org uuid,p_quote uuid)
returns uuid language plpgsql security definer set search_path=public as $function$
declare q public.quotes%rowtype;v_order uuid;v_number text;
begin
 perform public.assert_org_access(p_org);perform public.assert_org_permission(p_org,'orders.manage');
 select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
 if not found then raise exception 'Devis introuvable';end if;
 if q.status<>'accepted' then raise exception 'Seul un devis accepté peut devenir une commande';end if;
 if exists(select 1 from public.orders where quote_id=p_quote and organization_id=p_org) then raise exception 'Ce devis possède déjà une commande';end if;
 v_number:=public.next_document_number(p_org,'order');
 insert into public.orders(organization_id,customer_id,quote_id,number,status,order_date,subtotal,tax_total,total,notes,created_by)
 values(p_org,q.customer_id,q.id,v_number,'confirmed',current_date,q.subtotal,q.tax_total,q.total,q.notes,auth.uid()) returning id into v_order;
 insert into public.order_lines(organization_id,order_id,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount)
 select organization_id,v_order,service_id,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount
 from public.quote_lines where quote_id=q.id and organization_id=p_org order by sort_order;
 update public.quotes set status='converted',updated_at=now() where id=q.id;
 perform public.audit_event(p_org,'quote.converted_to_order','quote',q.id,jsonb_build_object('status','accepted'),jsonb_build_object('status','converted','order_id',v_order));
 return v_order;
end;$function$;

-- Use the source order line's description and tax rate, while allowing the invoice
-- preparer to review and edit its unit price, quantity and discount before saving.
create or replace function public.create_invoice_draft(p_org uuid,p_customer uuid,p_due_date date,p_lines jsonb,p_order uuid default null)
returns uuid language plpgsql security definer set search_path=public as $function$
declare v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;v_description text;gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
begin
 perform public.assert_org_access(p_org);perform public.assert_org_permission(p_org,'invoices.create');
 if p_due_date is null or p_due_date<current_date then raise exception 'Échéance invalide';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then raise exception 'La facture doit contenir entre 1 et 100 prestations';end if;
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
 if p_order is not null then
  if not exists(select 1 from public.orders where id=p_order and organization_id=p_org and status in ('confirmed','in_progress','completed')) then raise exception 'Commande invalide';end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org and status<>'cancelled') then raise exception 'Cette commande possède déjà une facture active';end if;
 end if;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=coalesce((r->>'quantity')::numeric,0);d:=coalesce((r->>'discount_pct')::numeric,0);
  if q<=0 or d<0 or d>100 then raise exception 'Ligne de facture invalide';end if;
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  unit_price:=coalesce(nullif(r->>'unit_price','')::numeric,s.unit_price);if unit_price<0 then raise exception 'Prix unitaire invalide';end if;
  tax_rate:=s.tax_rate;
  if nullif(r->>'order_line_id','') is not null then
   if p_order is null then raise exception 'Ligne de commande sans commande source';end if;
   select ol.tax_rate into tax_rate from public.order_lines ol where ol.id=(r->>'order_line_id')::uuid and ol.organization_id=p_org and ol.order_id=p_order and ol.service_id=s.id;
   if not found then raise exception 'Ligne de commande source invalide';end if;
  end if;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 end loop;
 v_number:=public.next_document_number(p_org,'invoice');
 insert into public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
 values(p_org,p_customer,p_order,v_number,'draft',current_date,p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid()) returning id into v_invoice;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=(r->>'quantity')::numeric;d:=coalesce((r->>'discount_pct')::numeric,0);
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  unit_price:=coalesce(nullif(r->>'unit_price','')::numeric,s.unit_price);tax_rate:=s.tax_rate;v_description:=s.name;
  if nullif(r->>'order_line_id','') is not null then
   select ol.tax_rate,ol.description into tax_rate,v_description from public.order_lines ol
   where ol.id=(r->>'order_line_id')::uuid and ol.organization_id=p_org and ol.order_id=p_order and ol.service_id=s.id;
   if not found then raise exception 'Ligne de commande source invalide';end if;
  end if;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_invoice,s.id,v_description,q,s.unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);v_sort:=v_sort+1;
 end loop;
 perform public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,null,jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));return v_invoice;
end;$function$;
revoke all on function public.convert_quote_to_order(uuid,uuid) from public,anon;
grant execute on function public.convert_quote_to_order(uuid,uuid) to authenticated;
revoke all on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) to authenticated;
