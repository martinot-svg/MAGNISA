-- Preserve order-line discounts when creating an invoice directly from an order.
create or replace function public.create_invoice_draft_from_order(p_org uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path=public as $function$
declare
  o public.orders%rowtype; v_invoice uuid; v_number text; v_days integer;
  v_subtotal numeric(18,2); v_discount numeric(18,2); v_tax numeric(18,2); v_total numeric(18,2);
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'invoices.create');
  select * into o from public.orders
   where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status not in ('confirmed','in_progress','completed') then raise exception 'Statut de commande incompatible'; end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org and status<>'cancelled') then
    raise exception 'Cette commande possède déjà une facture active';
  end if;

  select
    coalesce(sum(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))),0),
    coalesce(sum(coalesce(ol.discount_amount,0)),0),
    coalesce(sum(round(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))*ol.tax_rate/100,2)),0),
    coalesce(sum(ol.line_total),0)
  into v_subtotal,v_discount,v_tax,v_total
  from public.order_lines ol where ol.order_id=o.id and ol.organization_id=p_org;
  if not exists(select 1 from public.order_lines where order_id=o.id and organization_id=p_org) then
    raise exception 'La commande ne contient aucune ligne';
  end if;

  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,o.customer_id,o.quote_id,o.id,v_number,'draft',current_date,current_date+coalesce(v_days,30),v_subtotal,v_discount,v_tax,v_total,0,v_total,o.notes,auth.uid())
  returning id into v_invoice;

  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select ol.organization_id,v_invoice,ol.service_id,ol.description,ol.quantity,ol.unit,ol.unit_price,
    coalesce(ol.discount_pct,0),coalesce(ol.discount_amount,0),
    coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2)),
    ol.tax_rate,
    round(coalesce(ol.taxable_amount,round(ol.quantity*ol.unit_price-coalesce(ol.discount_amount,0),2))*ol.tax_rate/100,2),
    ol.line_total,ol.sort_order
  from public.order_lines ol where ol.order_id=o.id and ol.organization_id=p_org order by ol.sort_order;

  perform public.audit_event(p_org,'invoice.created_from_order','invoice',v_invoice,null,
    jsonb_build_object('order_id',o.id,'number',v_number,'subtotal',v_subtotal,'discount_total',v_discount,'tax_total',v_tax,'total',v_total));
  return v_invoice;
end;
$function$;
revoke all on function public.create_invoice_draft_from_order(uuid,uuid) from public,anon;
grant execute on function public.create_invoice_draft_from_order(uuid,uuid) to authenticated;
