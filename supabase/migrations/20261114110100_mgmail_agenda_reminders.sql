-- MGMail Agenda : rappels dans le centre de notifications MAGNISA.
-- Envoi e-mail Internet NON activé : aucun fournisseur ni domaine externe simulé.
create or replace function private.mgmail_validate_agenda_time_zone()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $zone$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then
    raise exception 'Fuseau horaire non reconnu : %',new.time_zone using errcode='22023';
  end if;
  return new;
end;
$zone$;
revoke all on function private.mgmail_validate_agenda_time_zone() from public,anon,authenticated;
drop trigger if exists trg_mgmail_agenda_validate_zone on public.mgmail_agenda_events;
create trigger trg_mgmail_agenda_validate_zone
  before insert or update of time_zone on public.mgmail_agenda_events
  for each row execute function private.mgmail_validate_agenda_time_zone();

create or replace function public.run_mgmail_agenda_reminders(
  p_run_at timestamptz default now()
) returns integer
language plpgsql security definer
set search_path=pg_catalog,public,private
as $agenda$
declare
  e record;
  v_run_date date;
  v_run_time time without time zone;
  v_offset integer;
  v_inserted integer;
  v_total integer:=0;
begin
  if p_run_at is null then
    raise exception 'La date de traitement est obligatoire' using errcode='22023';
  end if;
  for e in
    select ev.* from public.mgmail_agenda_events ev
    where ev.status='scheduled' and cardinality(ev.reminder_days)>0
      and ev.start_day>=((p_run_at at time zone ev.time_zone)::date)
      and ev.start_day<=((p_run_at at time zone ev.time_zone)::date)+365
  loop
    v_run_date := (p_run_at at time zone e.time_zone)::date;
    v_run_time := (p_run_at at time zone e.time_zone)::time without time zone;
    v_offset := e.start_day-v_run_date;
    if not v_offset=any(e.reminder_days) then continue; end if;
    -- Éviter une alerte du jour J lorsqu'un rendez-vous a déjà commencé.
    if v_offset=0 and v_run_time>=e.start_time then continue; end if;

    insert into public.notifications(
      organization_id,recipient_user_id,category,priority,title,body,
      action_url,entity_type,entity_id,metadata,dedupe_key
    )
    select e.organization_id,r.user_id,'service',
      case when v_offset=0 then 'urgent'
           when v_offset<=1 then 'attention'
           else 'info' end,
      'Rappel MGMail : '||left(e.title,155),
      'Événement prévu le '||to_char(e.start_day,'DD/MM/YYYY')
        ||' à '||to_char(e.start_time,'HH24:MI')||'.',
      '/magnimail/agenda?month='||to_char(e.start_day,'YYYY-MM'),
      'mgmail_agenda_event',e.id,
      jsonb_build_object(
        'scope',e.scope,'offset_days',v_offset,
        'start_day',e.start_day,'channel','in_app'
      ),
      'mgmail-agenda:'||e.id::text||':j'||v_offset::text||':'||e.start_day::text
    from (
      select e.created_by as user_id where e.scope='personal'
      union
      select m.user_id from public.organization_members m
        where m.organization_id=e.organization_id and m.status='active'
          and (
            e.scope='company'
            or (e.scope='service' and m.department=e.department)
          )
      union
      select e.created_by as user_id where e.scope='service'
    ) r
    join public.organization_members active_member
      on active_member.organization_id=e.organization_id
       and active_member.user_id=r.user_id and active_member.status='active'
    left join public.notification_preferences prefs
      on prefs.organization_id=e.organization_id and prefs.user_id=r.user_id
    where r.user_id is not null and coalesce(prefs.in_app_enabled,true)
    on conflict (organization_id,recipient_user_id,dedupe_key) do nothing;

    get diagnostics v_inserted=row_count;
    v_total:=v_total+v_inserted;
  end loop;
  return v_total;
end;
$agenda$;
revoke all on function public.run_mgmail_agenda_reminders(timestamptz)
  from public,anon,authenticated;
grant execute on function public.run_mgmail_agenda_reminders(timestamptz) to service_role;
