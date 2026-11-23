-- Configurable internal reminders for recurring service contract end dates.
-- Reuses the existing notification rules/events/notifications pipeline.
create or replace function public.run_recurring_contract_expiry_reminders(p_run_date date default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_today date := coalesce(p_run_date, (now() at time zone 'Indian/Antananarivo')::date);
  v_contract record;
  v_member record;
  v_rule_enabled boolean;
  v_offsets integer[];
  v_offset integer;
  v_event_key text;
  v_event_id uuid;
  v_created integer := 0;
  v_inserted integer;
begin
  for v_contract in
    select c.id, c.organization_id, c.customer_id, c.description, c.end_date
    from public.recurring_service_contracts c
    where c.status = 'active'
      and c.end_date between v_today - 30 and v_today + 30
    order by c.organization_id, c.end_date, c.id
  loop
    select r.enabled, r.reminder_offsets_days
      into v_rule_enabled, v_offsets
    from public.notification_rules r
    where r.organization_id = v_contract.organization_id
      and r.rule_key = 'recurring_contract_end';

    if not found then
      v_rule_enabled := true;
      v_offsets := array[30, 7, 0]::integer[];
    elsif not coalesce(v_rule_enabled, false) then
      continue;
    else
      v_offsets := coalesce(v_offsets, array[]::integer[]);
    end if;

    foreach v_offset in array v_offsets loop
      if v_contract.end_date <> v_today + v_offset then
        continue;
      end if;

      v_event_key := 'recurring-contract-end:' || v_contract.id::text || ':' || v_offset::text;
      v_event_id := null;

      insert into public.notification_events(
        organization_id, event_key, event_type, source_table, source_id, payload
      ) values (
        v_contract.organization_id,
        v_event_key,
        'sales.recurring_contract.expiry_reminder',
        'recurring_service_contracts',
        v_contract.id,
        jsonb_build_object(
          'contract_description', v_contract.description,
          'customer_id', v_contract.customer_id,
          'end_date', v_contract.end_date,
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
        where om.organization_id = v_contract.organization_id
          and om.status = 'active'
          and coalesce(np.in_app_enabled, true)
          and not coalesce(np.category_preferences, '{}'::jsonb) @> jsonb_build_object('sales', false)
      loop
        insert into public.notifications(
          organization_id, recipient_user_id, category, priority, title, body,
          action_url, entity_type, entity_id, metadata, dedupe_key
        ) values (
          v_contract.organization_id,
          v_member.user_id,
          'sales',
          case when v_offset <= 0 then 'attention' else 'normal' end,
          case
            when v_offset = 0 then 'Contrat récurrent arrivant à échéance'
            when v_offset < 0 then 'Contrat récurrent arrivé à échéance'
            else 'Fin de contrat récurrent à venir'
          end,
          case
            when v_offset = 0 then 'Le contrat « ' || coalesce(v_contract.description, 'Prestation récurrente') || ' » arrive à échéance aujourd’hui.'
            when v_offset < 0 then 'Le contrat « ' || coalesce(v_contract.description, 'Prestation récurrente') || ' » est arrivé à échéance depuis ' || abs(v_offset)::text || ' jour(s).'
            else 'Le contrat « ' || coalesce(v_contract.description, 'Prestation récurrente') || ' » arrive à échéance dans ' || v_offset::text || ' jour(s).'
          end,
          '/clients/' || v_contract.customer_id::text,
          'recurring_contract',
          v_contract.id,
          jsonb_build_object('event_id', v_event_id, 'offset_days', v_offset, 'end_date', v_contract.end_date),
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

revoke all on function public.run_recurring_contract_expiry_reminders(date) from public, anon, authenticated;
grant execute on function public.run_recurring_contract_expiry_reminders(date) to service_role;
