-- Distinguish remote-MTA relay acceptance from final recipient delivery.
-- Postfix status=sent means the next-hop server accepted responsibility; it is
-- not proof that the recipient mailbox received the message. Final delivery is
-- reserved for a trusted Delivery Status Notification (DSN).
alter table public.orbit_external_messages
  drop constraint if exists orbit_external_message_direction_status;
alter table public.orbit_external_messages
  add constraint orbit_external_message_direction_status
  check (
    (direction='incoming' and status='received' and request_key is null)
    or (direction='outgoing' and status in (
      'draft','queued','sending','accepted','relayed','deferred',
      'delivered','failed','bounced','uncertain'
    ))
  );

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
    or p_event_state not in ('relayed','deferred','delivered','bounced','failed') then
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
    when p_event_state = 'relayed' then array['accepted','sending','uncertain','deferred']::text[]
    when p_event_state = 'deferred' then array['accepted','sending','uncertain','deferred']::text[]
    when p_event_state = 'delivered' then array['relayed']::text[]
    when p_event_state = 'bounced' then array['accepted','sending','uncertain','deferred','relayed']::text[]
    else array['accepted','sending','uncertain','deferred']::text[]
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
  'Applies signed Postfix relay/defer/bounce/failure receipts; only a trusted DSN may mark final delivery.';
