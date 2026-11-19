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
  v_sender_mailbox uuid := gen_random_uuid();
  v_recipient_mailbox uuid := gen_random_uuid();
  v_message_id uuid := gen_random_uuid();
  v_insert_events integer;
  v_delete_events integer;
begin
  insert into public.organizations (id, name)
  values (v_org, 'MAGNIBOX isolated outbox runtime test');

  insert into public.mgmail_internal_namespaces (organization_id, slug)
  values (v_org, 'sync-test-' || left(replace(v_org::text, '-', ''), 12));

  -- Prove source mutations and outbox events share the same transaction.
  insert into public.mgmail_internal_mailboxes (
    id, organization_id, local_part, display_name
  ) values
    (v_sender_mailbox, v_org, 'sync-sender-' || left(v_sender_mailbox::text, 8), 'Sync sender'),
    (v_recipient_mailbox, v_org, 'sync-recipient-' || left(v_recipient_mailbox::text, 8), 'Sync recipient');

  insert into public.mgmail_internal_messages (
    id, organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
  ) values (
    v_message_id, v_org, v_sender_mailbox, v_recipient_mailbox,
    'Synthetic outbox trigger test', 'No real message content'
  );

  select count(*) into v_insert_events
  from public.magnibox_sync_outbox
  where organization_id = v_org
    and aggregate_type = 'internal_message'
    and aggregate_id = v_message_id
    and event_type = 'message.created';
  if v_insert_events <> 1 then
    raise exception 'Outbox runtime: internal message insert did not enqueue exactly one event';
  end if;

  delete from public.mgmail_internal_messages where id = v_message_id;

  select count(*) into v_delete_events
  from public.magnibox_sync_outbox
  where organization_id = v_org
    and aggregate_type = 'internal_message'
    and aggregate_id = v_message_id
    and event_type = 'message.deleted';
  if v_delete_events <> 1 then
    raise exception 'Outbox runtime: internal message delete did not enqueue exactly one event';
  end if;

  -- Continue with isolated lease/retry state-machine tests.
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
