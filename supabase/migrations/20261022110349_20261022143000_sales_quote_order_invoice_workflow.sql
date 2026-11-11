create or replace function public.cancel_quote(p_org uuid, p_quote uuid, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare q public.quotes%rowtype;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'quotes.edit');
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Motif d''annulation obligatoire'; end if;
  select * into q from public.quotes where id=p_quote and organization_id=p_org for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if q.status not in ('draft','sent','negotiating') then raise exception 'Ce devis ne peut plus être annulé'; end if;
  update public.quotes set status='cancelled', notes=case when coalesce(trim(notes),'')='' then 'Annulation: '||trim(p_reason) else notes||E'\nAnnulation: '||trim(p_reason) end, updated_at=now() where id=q.id;
  perform public.audit_event(p_org,'quote.cancelled','quote',q.id,jsonb_build_object('status',q.status),jsonb_build_object('status','cancelled','reason',trim(p_reason)));
end; $$;

create or replace function public.cancel_order(p_org uuid, p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'orders.manage');
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Motif d''annulation obligatoire'; end if;
  select * into o from public.orders where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status not in ('draft','confirmed','in_progress') then raise exception 'Cette commande ne peut plus être annulée'; end if;
  if exists(select 1 from public.invoices where order_id=o.id and organization_id=p_org and status <> 'cancelled') then raise exception 'Cette commande possède déjà une facture active'; end if;
  update public.orders set status='cancelled', notes=case when coalesce(trim(notes),'')='' then 'Annulation: '||trim(p_reason) else notes||E'\nAnnulation: '||trim(p_reason) end, updated_at=now() where id=o.id;
  perform public.audit_event(p_org,'order.cancelled','order',o.id,jsonb_build_object('status',o.status),jsonb_build_object('status','cancelled','reason',trim(p_reason)));
end; $$;

create or replace function public.create_invoice_draft_from_order(p_org uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype; v_invoice uuid; v_number text; v_days int;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'invoices.create');
  select * into o from public.orders where id=p_order and organization_id=p_org for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if o.status not in ('confirmed','in_progress','completed') then raise exception 'Statut de commande incompatible'; end if;
  if exists(select 1 from public.invoices where order_id=p_order and organization_id=p_org and status <> 'cancelled') then raise exception 'Cette commande possède déjà une facture active'; end if;
  select default_payment_days into v_days from public.company_settings where organization_id=p_org;
  v_number:=public.next_document_number(p_org,'invoice');
  insert into public.invoices(organization_id,customer_id,quote_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,notes,created_by)
  values(p_org,o.customer_id,o.quote_id,o.id,v_number,'draft',current_date,current_date+coalesce(v_days,30),o.subtotal,0,o.tax_total,o.total,0,o.total,o.notes,auth.uid()) returning id into v_invoice;
  insert into public.invoice_lines(organization_id,invoice_id,service_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  select organization_id,v_invoice,service_id,description,quantity,unit,unit_price,0,0,round(quantity*unit_price,2),tax_rate,round((quantity*unit_price)*tax_rate/100,2),line_total,sort_order from public.order_lines where order_id=o.id order by sort_order;
  perform public.audit_event(p_org,'invoice.created_from_order','invoice',v_invoice,null,jsonb_build_object('order_id',o.id,'number',v_number));
  return v_invoice;
end; $$;

create or replace function public.update_invoice_line(p_org uuid, p_line uuid, p_quantity numeric, p_discount_pct numeric)
returns void language plpgsql security definer set search_path=public as $$
declare l public.invoice_lines%rowtype; s public.services%rowtype; gross numeric; disc numeric; taxable numeric; tax numeric; total numeric; inv uuid;
begin
  perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'invoices.create');
  if p_quantity <= 0 then raise exception 'Quantité invalide'; end if;
  if p_discount_pct < 0 or p_discount_pct > 100 then raise exception 'Remise invalide'; end if;
  select * into l from public.invoice_lines where id=p_line and organization_id=p_org for update;
  if not found then raise exception 'Ligne de facture introuvable'; end if;
  inv:=l.invoice_id;
  if not exists(select 1 from public.invoices where id=inv and organization_id=p_org and status='draft') then raise exception 'Seule une facture brouillon peut être modifiée'; end if;
  select * into s from public.services where id=l.service_id and organization_id=p_org;
  if not found then raise exception 'Prestation introuvable'; end if;
  gross:=round(p_quantity*s.unit_price,2); disc:=round(gross*p_discount_pct/100,2); taxable:=gross-disc; tax:=round(taxable*s.tax_rate/100,2); total:=taxable+tax;
  update public.invoice_lines set quantity=p_quantity,unit_price=s.unit_price,discount_pct=p_discount_pct,discount_amount=disc,taxable_amount=taxable,tax_rate=s.tax_rate,tax_amount=tax,line_total=total where id=l.id;
  update public.invoices i set subtotal=x.subtotal,discount_total=x.discount_total,tax_total=x.tax_total,total=x.total,balance_due=x.total-i.paid_amount,updated_at=now() from (select invoice_id,sum(taxable_amount) subtotal,sum(discount_amount) discount_total,sum(tax_amount) tax_total,sum(line_total) total from public.invoice_lines where invoice_id=inv group by invoice_id) x where i.id=inv;
end; $$;

create or replace function public.delete_invoice_line(p_org uuid, p_line uuid)
returns void language plpgsql security definer set search_path=public as $$
declare inv uuid;
begin
  perform public.assert_org_access(p_org); perform public.assert_org_permission(p_org,'invoices.create');
  select invoice_id into inv from public.invoice_lines l join public.invoices i on i.id=l.invoice_id where l.id=p_line and l.organization_id=p_org and i.organization_id=p_org and i.status='draft' for update;
  if inv is null then raise exception 'Ligne introuvable ou facture non modifiable'; end if;
  delete from public.invoice_lines where id=p_line and organization_id=p_org;
  update public.invoices i set subtotal=coalesce(x.subtotal,0),discount_total=coalesce(x.discount_total,0),tax_total=coalesce(x.tax_total,0),total=coalesce(x.total,0),balance_due=coalesce(x.total,0)-i.paid_amount,updated_at=now() from (select invoice_id,sum(taxable_amount) subtotal,sum(discount_amount) discount_total,sum(tax_amount) tax_total,sum(line_total) total from public.invoice_lines where invoice_id=inv group by invoice_id) x where i.id=inv;
  update public.invoices set subtotal=0,discount_total=0,tax_total=0,total=0,balance_due=0,updated_at=now() where id=inv and not exists(select 1 from public.invoice_lines where invoice_id=inv);
end; $$;

grant execute on function public.cancel_quote(uuid,uuid,text) to authenticated;
grant execute on function public.cancel_order(uuid,uuid,text) to authenticated;
grant execute on function public.create_invoice_draft_from_order(uuid,uuid) to authenticated;
grant execute on function public.update_invoice_line(uuid,uuid,numeric,numeric) to authenticated;
grant execute on function public.delete_invoice_line(uuid,uuid) to authenticated;