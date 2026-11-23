-- Scheduled prospect follow-ups; reuse the existing CRM notification center.
alter table public.prospects
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists follow_up_note text;

create index if not exists prospects_follow_up_due_idx
  on public.prospects (organization_id, next_follow_up_at)
  where next_follow_up_at is not null and status not in ('won','lost');

create or replace function public.run_prospect_follow_up_reminders(p_run_date date default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_today date := coalesce(p_run_date, (now() at time zone 'Indian/Antananarivo')::date);
  v_prospect record;
  v_member record;
  v_event_key text;
  v_event_id uuid;
  v_created integer := 0;
  v_inserted integer;
begin
  for v_prospect in
    select p.id, p.organization_id, p.name, p.status, p.next_follow_up_at,
           p.follow_up_note, p.current_owner_id
    from public.prospects p
    where p.next_follow_up_at is not null
      and (p.next_follow_up_at at time zone 'Indian/Antananarivo')::date <= v_today
      and p.status not in ('won','lost')
    order by p.organization_id, p.next_follow_up_at, p.id
  loop
    v_event_key := 'prospect-follow-up:' || v_prospect.id::text || ':' ||
      to_char(v_prospect.next_follow_up_at at time zone 'UTC', 'YYYYMMDDHH24MISS');
    v_event_id := null;
    insert into public.notification_events(
      organization_id, event_key, event_type, source_table, source_id, payload
    ) values (
      v_prospect.organization_id, v_event_key, 'crm.prospect.follow_up_due',
      'prospects', v_prospect.id,
      jsonb_build_object('prospect_name',v_prospect.name,'status',v_prospect.status,
        'follow_up_at',v_prospect.next_follow_up_at,'note',v_prospect.follow_up_note)
    )
    on conflict (organization_id,event_key) do nothing
    returning id into v_event_id;
    if v_event_id is null then continue; end if;

    for v_member in
      select om.user_id
      from public.organization_members om
      left join public.notification_preferences np
        on np.organization_id=om.organization_id and np.user_id=om.user_id
      where om.organization_id=v_prospect.organization_id
        and om.status='active'
        and coalesce(np.in_app_enabled,true)
        and not coalesce(np.category_preferences,'{}'::jsonb) @> jsonb_build_object('service',false)
        and (v_prospect.current_owner_id is null or om.user_id=v_prospect.current_owner_id)
    loop
      insert into public.notifications(
        organization_id,recipient_user_id,category,priority,title,body,
        action_url,entity_type,entity_id,metadata,dedupe_key
      ) values (
        v_prospect.organization_id,v_member.user_id,'service','attention',
        'Relance prospect à effectuer',
        'Le suivi prévu pour ' || v_prospect.name || ' est arrivé à échéance.' ||
          case when coalesce(v_prospect.follow_up_note,'')='' then ''
          else ' Note : ' || v_prospect.follow_up_note end,
        '/prospects/' || v_prospect.id::text,'prospect',v_prospect.id,
        jsonb_build_object('event_id',v_event_id,'follow_up_at',v_prospect.next_follow_up_at),
        v_event_key
      )
      on conflict (organization_id,recipient_user_id,dedupe_key) do nothing;
      get diagnostics v_inserted = row_count;
      v_created := v_created + v_inserted;
    end loop;
  end loop;
  return v_created;
end;
$$;

revoke all on function public.run_prospect_follow_up_reminders(date) from public, anon, authenticated;
grant execute on function public.run_prospect_follow_up_reminders(date) to service_role;
