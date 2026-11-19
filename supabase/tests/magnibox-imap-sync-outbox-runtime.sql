-- Runtime contract for the MAGNIBOX lease-fenced outbox.
-- Creates only synthetic rows inside a transaction and rolls everything back.
begin;

do $outbox_runtime$
declare
  v_org uuid := gen_random_uuid();
  v_first_id uuid := gen_random_uuid();
  v_second_id uuid := gen_random_uuid();
  v_claim record;
  v_count integer;
  v_old_token uuid;
  v_new_token uuid;
  v_state text;
begin
  insert into public.organizations (id, name)
  values (v_org, 'MAGNIBOX isolated outbox runtime test');

  insert into public.magnibox_sync_outbox (
    id, organization_id, aggregate_type, aggregate_id,
    event_type, dedupe_key, payload
  ) values (
    v_first_id, v_org, 'internal_message', gen_random_uuid(),
    'message.created', 'runtime:' || v_first_id::text,
    jsonb_build_object('synthetic', true)
  );

  -- First worker claims the event and receives a fencing token.
  select * into v_claim
  from public.magnibox_claim_sync_events('runtime-worker-a', 1, 60);
  if v_claim.id is distinct from v_first_id
    or v_claim.status is distinct from 'processing'
    or v_claim.attempts <> 1
    or v_claim.lease_token is null then
    raise exception 'Outbox runtime: first claim did not issue a valid lease';
  end if;
  v_old_token := v_claim.lease_token;

  -- A second worker cannot claim an event while the first lease is active.
  select count(*) into v_count
  from public.magnibox_claim_sync_events('runtime-worker-b', 1, 60);
  if v_count <> 0 then
    raise exception 'Outbox runtime: active lease was claimed twice';
  end if;

  -- Simulate expiry and verify that a new worker fences the stale token.
  update public.magnibox_sync_outbox
  set available_at = clock_timestamp() - interval '1 second'
  where id = v_first_id;
  select * into v_claim
  from public.magnibox_claim_sync_events('runtime-worker-b', 1, 60);
  if v_claim.id is distinct from v_first_id or v_claim.attempts <> 2 then
    raise exception 'Outbox runtime: expired lease was not reclaimed';
  end if;
  v_new_token := v_claim.lease_token;
  if v_new_token is null or v_new_token = v_old_token then
    raise exception 'Outbox runtime: reclaim did not rotate the lease token';
  end if;
  if public.magnibox_complete_sync_event(v_first_id, v_old_token) then
    raise exception 'Outbox runtime: stale worker acknowledged a newer lease';
  end if;
  if not public.magnibox_complete_sync_event(v_first_id, v_new_token) then
    raise exception 'Outbox runtime: current worker could not acknowledge event';
  end if;

  -- Retry path: failure releases the lease and makes the event retryable.
  insert into public.magnibox_sync_outbox (
    id, organization_id, aggregate_type, aggregate_id,
    event_type, dedupe_key, payload
  ) values (
    v_second_id, v_org, 'external_message', gen_random_uuid(),
    'message.created', 'runtime:' || v_second_id::text,
    jsonb_build_object('synthetic', true)
  );
  select * into v_claim
  from public.magnibox_claim_sync_events('runtime-worker-c', 1, 60);
  if v_claim.id is distinct from v_second_id then
    raise exception 'Outbox runtime: second event was not claimed';
  end if;
  v_state := public.magnibox_fail_sync_event(
    v_second_id, v_claim.lease_token, 'synthetic transient error',
    true, 1, 3
  );
  if v_state is distinct from 'pending' then
    raise exception 'Outbox runtime: retryable failure did not return to pending';
  end if;

  update public.magnibox_sync_outbox
  set available_at = clock_timestamp() - interval '1 second'
  where id = v_second_id;
  select * into v_claim
  from public.magnibox_claim_sync_events('runtime-worker-d', 1, 60);
  if v_claim.id is distinct from v_second_id or v_claim.attempts <> 2 then
    raise exception 'Outbox runtime: retry was not claimable with incremented attempts';
  end if;

  v_state := public.magnibox_fail_sync_event(
    v_second_id, v_claim.lease_token, 'synthetic permanent error',
    false, 1, 3
  );
  if v_state is distinct from 'dead' then
    raise exception 'Outbox runtime: permanent failure did not enter dead-letter state';
  end if;

  raise notice 'PASS MAGNIBOX outbox runtime: single claim, lease exclusion, expiry fencing, stale ACK rejection, retry and dead-letter transition';
end
$outbox_runtime$;

rollback;
