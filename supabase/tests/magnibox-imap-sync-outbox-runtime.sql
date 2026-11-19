
-- Runtime contract for the MAGNIBOX lease-fenced outbox.
-- Creates only synthetic rows inside a transaction and rolls everything back.

BEGIN;

DO $outbox_runtime$
DECLARE
  v_org UUID := gen_random_uuid();
  v_first_id UUID := gen_random_uuid();
  v_second_id UUID := gen_random_uuid();
  v_claim RECORD;
  v_count INTEGER;
  v_old_token UUID;
  v_new_token UUID;
  v_state TEXT;
  v_sender_mailbox UUID := gen_random_uuid();
  v_recipient_mailbox UUID := gen_random_uuid();
  v_message_id UUID := gen_random_uuid();
  v_insert_events INTEGER;
  v_delete_events INTEGER;
BEGIN
  INSERT INTO public.organizations (id, name)
  VALUES (v_org, 'MAGNIBOX isolated outbox runtime test');

  INSERT INTO public.mgmail_internal_namespaces (organization_id, slug)
  VALUES (
    v_org,
    'sync-test-' || LEFT(REPLACE(v_org::TEXT, '-', ''), 12)
  );

  -- Prove source mutations and outbox events share the same transaction.
  INSERT INTO public.mgmail_internal_mailboxes (
    id, organization_id, local_part, display_name
  )
  VALUES
    (
      v_sender_mailbox,
      v_org,
      'sync-sender-' || LEFT(v_sender_mailbox::TEXT, 8),
      'Sync sender'
    ),
    (
      v_recipient_mailbox,
      v_org,
      'sync-recipient-' || LEFT(v_recipient_mailbox::TEXT, 8),
      'Sync recipient'
    );

  INSERT INTO public.mgmail_internal_messages (
    id,
    organization_id,
    sender_mailbox_id,
    recipient_mailbox_id,
    subject,
    body_text
  )
  VALUES (
    v_message_id,
    v_org,
    v_sender_mailbox,
    v_recipient_mailbox,
    'Synthetic outbox trigger test',
    'No real message content'
  );

  SELECT COUNT(*)
  INTO v_insert_events
  FROM public.magnibox_sync_outbox
  WHERE organization_id = v_org
    AND aggregate_type = 'internal_message'
    AND aggregate_id = v_message_id
    AND event_type = 'message.created';

  IF v_insert_events <> 1 THEN
    RAISE EXCEPTION
      'Outbox runtime: internal message insert did not enqueue exactly one event';
  END IF;

  DELETE FROM public.mgmail_internal_messages
  WHERE id = v_message_id;

  SELECT COUNT(*)
  INTO v_delete_events
  FROM public.magnibox_sync_outbox
  WHERE organization_id = v_org
    AND aggregate_type = 'internal_message'
    AND aggregate_id = v_message_id
    AND event_type = 'message.deleted';

  IF v_delete_events <> 1 THEN
    RAISE EXCEPTION
      'Outbox runtime: internal message delete did not enqueue exactly one event';
  END IF;

  -- Remove the already-asserted trigger events so they cannot interfere
  -- with the independent lease state-machine scenario.
  DELETE FROM public.magnibox_sync_outbox
  WHERE organization_id = v_org
    AND aggregate_type = 'internal_message'
    AND aggregate_id = v_message_id;

  -- Continue with isolated lease/retry state-machine tests.
  INSERT INTO public.magnibox_sync_outbox (
    id,
    organization_id,
    aggregate_type,
    aggregate_id,
    event_type,
    dedupe_key,
    payload
  )
  VALUES (
    v_first_id,
    v_org,
    'internal_message',
    gen_random_uuid(),
    'message.created',
    'runtime:' || v_first_id::TEXT,
    jsonb_build_object('synthetic', TRUE)
  );

  -- First worker claims the event and receives a fencing token.
  SELECT *
  INTO v_claim
  FROM public.magnibox_claim_sync_events('runtime-worker-a', 1, 60);

  IF v_claim.id IS DISTINCT FROM v_first_id
    OR v_claim.status IS DISTINCT FROM 'processing'
    OR v_claim.attempts <> 1
    OR v_claim.lease_token IS NULL THEN
    RAISE EXCEPTION
      'Outbox runtime: first claim did not issue a valid lease';
  END IF;

  v_old_token := v_claim.lease_token;

  -- A second worker cannot claim an event while the first lease is active.
  SELECT COUNT(*)
  INTO v_count
  FROM public.magnibox_claim_sync_events('runtime-worker-b', 1, 60);

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'Outbox runtime: active lease was claimed twice';
  END IF;

  -- Simulate expiry and verify that a new worker fences the stale token.
  UPDATE public.magnibox_sync_outbox
  SET available_at = clock_timestamp() - INTERVAL '1 second'
  WHERE id = v_first_id;

  SELECT *
  INTO v_claim
  FROM public.magnibox_claim_sync_events('runtime-worker-b', 1, 60);

  IF v_claim.id IS DISTINCT FROM v_first_id
    OR v_claim.attempts <> 2 THEN
    RAISE EXCEPTION
      'Outbox runtime: expired lease was not reclaimed';
  END IF;

  v_new_token := v_claim.lease_token;

  IF v_new_token IS NULL OR v_new_token = v_old_token THEN
    RAISE EXCEPTION
      'Outbox runtime: reclaim did not rotate the lease token';
  END IF;

  IF public.magnibox_complete_sync_event(v_first_id, v_old_token) THEN
    RAISE EXCEPTION
      'Outbox runtime: stale worker acknowledged a newer lease';
  END IF;

  IF NOT public.magnibox_complete_sync_event(v_first_id, v_new_token) THEN
    RAISE EXCEPTION
      'Outbox runtime: current worker could not acknowledge event';
  END IF;

  -- Retry path: failure releases the lease and makes the event retryable.
  INSERT INTO public.magnibox_sync_outbox (
    id,
    organization_id,
    aggregate_type,
    aggregate_id,
    event_type,
    dedupe_key,
    payload
  )
  VALUES (
    v_second_id,
    v_org,
    'external_message',
    gen_random_uuid(),
    'message.created',
    'runtime:' || v_second_id::TEXT,
    jsonb_build_object('synthetic', TRUE)
  );

  SELECT *
  INTO v_claim
  FROM public.magnibox_claim_sync_events('runtime-worker-c', 1, 60);

  IF v_claim.id IS DISTINCT FROM v_second_id THEN
    RAISE EXCEPTION
      'Outbox runtime: second event was not claimed';
  END IF;

  v_state := public.magnibox_fail_sync_event(
    v_second_id,
    v_claim.lease_token,
    'synthetic transient error',
    TRUE,
    1,
    3
  );

  IF v_state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION
      'Outbox runtime: retryable failure did not return to pending';
  END IF;

  UPDATE public.magnibox_sync_outbox
  SET available_at = clock_timestamp() - INTERVAL '1 second'
  WHERE id = v_second_id;

  SELECT *
  INTO v_claim
  FROM public.magnibox_claim_sync_events('runtime-worker-d', 1, 60);

  IF v_claim.id IS DISTINCT FROM v_second_id
    OR v_claim.attempts <> 2 THEN
    RAISE EXCEPTION
      'Outbox runtime: retry was not claimable with incremented attempts';
  END IF;

  v_state := public.magnibox_fail_sync_event(
    v_second_id,
    v_claim.lease_token,
    'synthetic permanent error',
    FALSE,
    1,
    3
  );

  IF v_state IS DISTINCT FROM 'dead' THEN
    RAISE EXCEPTION
      'Outbox runtime: permanent failure did not enter dead-letter state';
  END IF;

  RAISE NOTICE
    'PASS MAGNIBOX outbox runtime: single claim, lease exclusion, expiry fencing, stale ACK rejection, retry and dead-letter transition';

END;
$outbox_runtime$;

ROLLBACK;
