-- Preserve the tax rate captured on each order line when an invoice is created from that order.
create or replace function public.create_invoice_draft(p_org uuid,p_customer uuid,p_due_date date,p_lines jsonb,p_order uuid default null)
returns uuid language plpgsql security definer set search_path=public as $function$
declare v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
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
   select ol.tax_rate into tax_rate from public.order_lines ol
   where ol.id=(r->>'order_line_id')::uuid and ol.organization_id=p_org and ol.order_id=p_order and ol.service_id=s.id;
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
  unit_price:=coalesce(nullif(r->>'unit_price','')::numeric,s.unit_price);tax_rate:=s.tax_rate;
  if nullif(r->>'order_line_id','') is not null then
   select ol.tax_rate into tax_rate from public.order_lines ol
   where ol.id=(r->>'order_line_id')::uuid and ol.organization_id=p_org and ol.order_id=p_order and ol.service_id=s.id;
   if not found then raise exception 'Ligne de commande source invalide';end if;
  end if;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_invoice,s.id,s.name,q,s.unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);v_sort:=v_sort+1;
 end loop;
 perform public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,null,jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));return v_invoice;
end;$function$;
revoke all on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.create_invoice_draft(uuid,uuid,date,jsonb,uuid) to authenticated;
