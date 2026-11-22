-- Publish CRM lifecycle events into the existing in-app notification center.
-- This does not create a second notification queue or send external email/push.
create or replace function private.capture_crm_lifecycle_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_org uuid := (v_new->>'organization_id')::uuid;
  v_id uuid := (v_new->>'id')::uuid;
  v_status text := v_new->>'status';
  v_previous_status text := v_old->>'status';
  v_number text := coalesce(v_new->>'number', v_new->>'reference', v_id::text);
  v_event_type text;
  v_event_key text;
  v_category text;
  v_priority text := 'info';
  v_title text;
  v_body text;
  v_action_url text;
  v_member record;
begin
  if v_org is null or v_id is null or v_status is null then return new; end if;
  if tg_op = 'UPDATE' and v_status is not distinct from v_previous_status then return new; end if;

  if tg_table_name = 'orders' and v_status = 'confirmed' then
    v_event_type := 'crm.order.confirmed';
    v_category := 'service';
    v_title := 'Commande confirmée';
    v_body := 'La commande ' || v_number || ' vient d’être confirmée.';
    v_action_url := '/commandes/' || v_id::text;
  elsif tg_table_name = 'invoices' and v_status in ('issued','overdue','paid') then
    v_event_type := 'crm.invoice.' || v_status;
    v_category := case when v_status = 'paid' then 'payment' else 'finance' end;
    v_priority := case when v_status = 'overdue' then 'urgent' else 'info' end;
    v_title := case v_status
      when 'issued' then 'Facture émise'
      when 'overdue' then 'Facture en retard'
      else 'Facture réglée'
    end;
    v_body := 'La facture ' || v_number || case v_status
      when 'issued' then ' a été émise.'
      when 'overdue' then ' est arrivée à échéance sans règlement complet.'
      else ' est maintenant soldée.'
    end;
    v_action_url := '/factures/' || v_id::text;
  elsif tg_table_name = 'payments' and v_status in ('confirmed','reconciled') then
    v_event_type := 'crm.payment.' || v_status;
    v_category := 'payment';
    v_title := case when v_status = 'confirmed' then 'Paiement confirmé' else 'Paiement rapproché' end;
    v_body := 'Un paiement de ' || coalesce(v_new->>'amount','0') || ' a été ' ||
      case when v_status = 'confirmed' then 'confirmé.' else 'rapproché.' end;
    v_action_url := '/factures/' || (v_new->>'invoice_id');
  else
    return new;
  end if;

  v_event_key := v_event_type || ':' || v_id::text;
  insert into public.notification_events(
    organization_id,event_key,event_type,source_table,source_id,payload
  ) values (
    v_org,v_event_key,v_event_type,tg_table_name,v_id,
    jsonb_build_object('status',v_status,'previous_status',v_previous_status,'number',v_number)
  ) on conflict (organization_id,event_key) do nothing;

  for v_member in
    select om.user_id
    from public.organization_members om
    left join public.notification_preferences np
      on np.organization_id=om.organization_id and np.user_id=om.user_id
    where om.organization_id=v_org and om.status='active'
      and coalesce(np.in_app_enabled,true)
      and not coalesce(np.category_preferences, '{}'::jsonb) @> jsonb_build_object(v_category,false)
  loop
    insert into public.notifications(
      organization_id,recipient_user_id,category,priority,title,body,action_url,
      entity_type,entity_id,metadata,dedupe_key
    ) values (
      v_org,v_member.user_id,v_category,v_priority,v_title,v_body,v_action_url,
      case when tg_table_name='orders' then 'order' when tg_table_name='invoices' then 'invoice' else 'payment' end,
      v_id,jsonb_build_object('event_type',v_event_type,'status',v_status),v_event_key
    ) on conflict (organization_id,recipient_user_id,dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function private.capture_crm_lifecycle_notification() from public, anon, authenticated;

drop trigger if exists notify_crm_order_confirmed on public.orders;
create trigger notify_crm_order_confirmed
after insert or update of status on public.orders
for each row execute function private.capture_crm_lifecycle_notification();

drop trigger if exists notify_crm_invoice_lifecycle on public.invoices;
create trigger notify_crm_invoice_lifecycle
after insert or update of status on public.invoices
for each row execute function private.capture_crm_lifecycle_notification();

drop trigger if exists notify_crm_payment_lifecycle on public.payments;
create trigger notify_crm_payment_lifecycle
after insert or update of status on public.payments
for each row execute function private.capture_crm_lifecycle_notification();
