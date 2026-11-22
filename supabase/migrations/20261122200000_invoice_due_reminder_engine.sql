-- Daily in-app reminders for unpaid customer invoices.
-- Reuses notification_rules, notification_events and notifications.
create or replace function public.run_invoice_due_reminders(p_run_date date default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_today date := coalesce(p_run_date, (now() at time zone 'Indian/Antananarivo')::date);
  v_invoice record;
  v_member record;
  v_rule_enabled boolean;
  v_offsets integer[];
  v_offset integer;
  v_event_key text;
  v_event_id uuid;
  v_created integer := 0;
  v_inserted integer;
begin
  for v_invoice in
    select i.id, i.organization_id, i.number, i.due_date, i.balance_due
    from public.invoices i
    where i.due_date between v_today - 30 and v_today + 30
      and i.balance_due > 0
      and i.status not in ('draft', 'cancelled', 'paid')
    order by i.organization_id, i.due_date, i.id
  loop
    select r.enabled, r.reminder_offsets_days
      into v_rule_enabled, v_offsets
    from public.notification_rules r
    where r.organization_id = v_invoice.organization_id
      and r.rule_key = 'invoice_due';

    if not found then
      v_rule_enabled := true;
      v_offsets := array[3, 1, 0, -1, -7]::integer[];
    elsif not coalesce(v_rule_enabled, false) then
      continue;
    else
      v_offsets := coalesce(v_offsets, array[]::integer[]);
    end if;

    foreach v_offset in array v_offsets loop
      if v_invoice.due_date <> v_today + v_offset then
        continue;
      end if;

      v_event_key := 'invoice-due-reminder:' || v_invoice.id::text || ':' || v_offset::text;
      v_event_id := null;

      insert into public.notification_events(
        organization_id, event_key, event_type, source_table, source_id, payload
      ) values (
        v_invoice.organization_id,
        v_event_key,
        case when v_offset < 0 then 'finance.invoice.overdue_reminder' else 'finance.invoice.due_reminder' end,
        'invoices',
        v_invoice.id,
        jsonb_build_object(
          'invoice_number', v_invoice.number,
          'due_date', v_invoice.due_date,
          'balance_due', v_invoice.balance_due,
          'offset_days', v_offset
        )
      )
      on conflict (organization_id, event_key) do nothing
      returning id into v_event_id;

      if v_event_id is null then
        continue;
      end if;

      for v_member in
        select om.user_id
        from public.organization_members om
        left join public.notification_preferences np
          on np.organization_id = om.organization_id and np.user_id = om.user_id
        where om.organization_id = v_invoice.organization_id
          and om.status = 'active'
          and coalesce(np.in_app_enabled, true)
          and not coalesce(np.category_preferences, '{}'::jsonb) @> jsonb_build_object('finance', false)
      loop
        insert into public.notifications(
          organization_id, recipient_user_id, category, priority, title, body,
          action_url, entity_type, entity_id, metadata, dedupe_key
        ) values (
          v_invoice.organization_id,
          v_member.user_id,
          'finance',
          case when v_offset < 0 then 'urgent' else 'attention' end,
          case
            when v_offset < 0 then 'Facture impayée après échéance'
            when v_offset = 0 then 'Facture à échéance aujourd’hui'
            else 'Échéance de facture à venir'
          end,
          case
            when v_offset < 0 then 'La facture ' || v_invoice.number || ' est en retard de ' || abs(v_offset)::text || ' jour(s). Reste dû : ' || to_char(v_invoice.balance_due, 'FM999G999G999G990D00') || '.'
            when v_offset = 0 then 'La facture ' || v_invoice.number || ' arrive à échéance aujourd’hui. Reste dû : ' || to_char(v_invoice.balance_due, 'FM999G999G999G990D00') || '.'
            else 'La facture ' || v_invoice.number || ' arrive à échéance dans ' || v_offset::text || ' jour(s). Reste dû : ' || to_char(v_invoice.balance_due, 'FM999G999G999G990D00') || '.'
          end,
          '/factures/' || v_invoice.id::text,
          'invoice',
          v_invoice.id,
          jsonb_build_object('event_id', v_event_id, 'offset_days', v_offset, 'due_date', v_invoice.due_date),
          v_event_key
        )
        on conflict (organization_id, recipient_user_id, dedupe_key) do nothing;

        get diagnostics v_inserted = row_count;
        v_created := v_created + v_inserted;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.run_invoice_due_reminders(date) from public, anon, authenticated;
grant execute on function public.run_invoice_due_reminders(date) to service_role;
