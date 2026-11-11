-- Reject null and non-array payloads before attempting to iterate quote lines.
create or replace function public.create_quote_draft(p_org uuid,p_customer uuid,p_valid_until date,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $function$
declare v_quote uuid;v_number text;r jsonb;s public.services%rowtype;q numeric;d numeric;unit_price numeric;gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
begin
 perform public.assert_org_access(p_org);perform public.assert_org_permission(p_org,'quotes.create');
 if not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide';end if;
 if p_valid_until is null or p_valid_until<current_date then raise exception 'Date de validité invalide';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Les lignes du devis doivent être un tableau';end if;
 if jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then raise exception 'Le devis doit contenir entre 1 et 100 prestations';end if;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=coalesce((r->>'quantity')::numeric,0);d:=coalesce((r->>'discount_pct')::numeric,0);
  if q<=0 or d<0 or d>100 or not (r ? 'unit_price') then raise exception 'Ligne de devis invalide';end if;
  unit_price:=(r->>'unit_price')::numeric;if unit_price<0 then raise exception 'Prix unitaire invalide';end if;
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  if not found then raise exception 'Prestation invalide';end if;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*s.tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 end loop;
 v_number:=public.next_document_number(p_org,'quote');
 insert into public.quotes(organization_id,customer_id,number,valid_until,subtotal,discount_total,tax_total,total,created_by)
 values(p_org,p_customer,v_number,p_valid_until,v_sub,v_disc,v_tax,v_total,auth.uid()) returning id into v_quote;
 for r in select value from jsonb_array_elements(p_lines) loop
  q:=(r->>'quantity')::numeric;d:=coalesce((r->>'discount_pct')::numeric,0);unit_price:=(r->>'unit_price')::numeric;
  select * into s from public.services where id=(r->>'service_id')::uuid and organization_id=p_org and is_active;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;tax:=round(taxable*s.tax_rate/100,2);total:=taxable+tax;
  insert into public.quote_lines(organization_id,quote_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  values(p_org,v_quote,s.id,s.name,q,s.unit,unit_price,d,disc,taxable,s.tax_rate,tax,total,v_sort);v_sort:=v_sort+1;
 end loop;
 perform public.audit_event(p_org,'quote.created','quote',v_quote,null,jsonb_build_object('number',v_number,'lines',jsonb_array_length(p_lines),'total',v_total));return v_quote;
end;$function$;
revoke all on function public.create_quote_draft(uuid,uuid,date,jsonb) from public,anon;
grant execute on function public.create_quote_draft(uuid,uuid,date,jsonb) to authenticated;
