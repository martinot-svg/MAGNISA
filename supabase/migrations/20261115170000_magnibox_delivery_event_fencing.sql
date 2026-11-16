-- Serialize signed delivery receipts and refuse ambiguous Postfix queue IDs.
create or replace function public.orbit_apply_magnibox_delivery_event(
  p_queue_id text,
  p_event_state text
) returns text
language plpgsql
security definer
set search_path = ''
as $magnibox_delivery$
declare
  v_count bigint;
  v_updated bigint;
  v_allowed text[];
begin
  if p_queue_id is null
    or upper(p_queue_id) !~ '^[A-F0-9]{5,20}$'
    or p_event_state is null
    or p_event_state not in ('accepted','bounced','failed','uncertain') then
    raise exception 'Invalid MAGNIBOX delivery event' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('magnibox-delivery:' || upper(p_queue_id), 0)
  );

  select count(*) into v_count
  from public.orbit_external_messages m
  where m.direction = 'outgoing'
    and m.provider_email_id = upper(p_queue_id);

  if v_count = 0 then return 'not_found'; end if;
  if v_count <> 1 then return 'ambiguous'; end if;

  v_allowed := case
    when p_event_state = 'bounced' then array['accepted','sending','uncertain','delivered']::text[]
    when p_event_state = 'uncertain' then array['accepted','sending']::text[]
    else array['accepted','sending','uncertain']::text[]
  end;

  update public.orbit_external_messages
  set status = p_event_state, updated_at = pg_catalog.now()
  where direction = 'outgoing'
    and provider_email_id = upper(p_queue_id)
    and status = any(v_allowed);
  get diagnostics v_updated = row_count;

  if v_updated = 0 then return 'ignored'; end if;
  if v_updated <> 1 then
    raise exception 'MAGNIBOX delivery event changed multiple rows' using errcode = '21000';
  end if;
  return 'updated';
end;
$magnibox_delivery$;

revoke all on function public.orbit_apply_magnibox_delivery_event(text,text)
  from public, anon, authenticated;
grant execute on function public.orbit_apply_magnibox_delivery_event(text,text)
  to service_role;

comment on function public.orbit_apply_magnibox_delivery_event(text,text) is
  'Applies signed Postfix delivery receipts under a queue-ID transaction lock; refuses ambiguous queue references.';
