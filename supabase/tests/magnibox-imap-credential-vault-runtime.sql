-- Runtime behavior tests for the MAGNIBOX IMAP credential vault.
-- Uses synthetic ciphertext and isolated fixtures only; transaction is rolled back.
\set ON_ERROR_STOP on
BEGIN;

DO $credential_runtime$
DECLARE
  v_org uuid := 'e2000000-0000-4000-8000-000000000001';
  v_other_org uuid := 'e2000000-0000-4000-8000-000000000002';
  v_mailbox uuid := 'e2000000-0000-4000-8000-000000000011';
  v_first_id uuid;
  v_second_id uuid;
  v_version integer;
  v_status text;
  v_count integer;
  v_revoked boolean;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'MAGNIBOX IMAP credential runtime test'),
           (v_other_org, 'MAGNIBOX IMAP isolation runtime test');

  INSERT INTO public.mgmail_internal_namespaces (organization_id, slug)
    VALUES (v_org, 'magnibox-imap-runtime'),
           (v_other_org, 'magnibox-imap-isolation');

  INSERT INTO public.mgmail_internal_mailboxes (id, organization_id, local_part)
    VALUES (v_mailbox, v_org, 'runtimebox');

  SELECT s.credential_id, s.credential_version, s.credential_status
    INTO v_first_id, v_version, v_status
    FROM public.magnibox_store_imap_credential(
      v_org, v_mailbox, 1, 'aes-256-gcm', 'ci-key',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'synthetic-ciphertext-v1',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'runtime-create-v1'
    ) s;
  IF v_version <> 1 OR v_status <> 'active' THEN
    RAISE EXCEPTION 'First credential creation did not produce active version 1';
  END IF;

  SELECT count(*) INTO v_count
    FROM public.magnibox_get_active_imap_credential(v_org, v_mailbox);
  IF v_count <> 1 THEN RAISE EXCEPTION 'Active credential lookup failed'; END IF;

  SELECT s.credential_id, s.credential_version, s.credential_status
    INTO v_second_id, v_version, v_status
    FROM public.magnibox_store_imap_credential(
      v_org, v_mailbox, 1, 'aes-256-gcm', 'ci-key',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'synthetic-ciphertext-v2',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'runtime-rotate-v2'
    ) s;
  IF v_version <> 2 OR v_status <> 'active' OR v_second_id = v_first_id THEN
    RAISE EXCEPTION 'Credential rotation did not produce active version 2';
  END IF;

  SELECT count(*) INTO v_count FROM public.magnibox_imap_credentials
    WHERE organization_id=v_org AND mailbox_id=v_mailbox
      AND credential_version=1 AND status='revoked';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Rotation did not revoke version 1'; END IF;

  -- Replaying the same idempotency key must return version 2, not create v3.
  SELECT s.credential_id, s.credential_version, s.credential_status
    INTO v_first_id, v_version, v_status
    FROM public.magnibox_store_imap_credential(
      v_org, v_mailbox, 1, 'aes-256-gcm', 'ci-key',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'different-retry-payload',
      'MDEyMzQ1Njc4OWFiY2RlZg==', 'runtime-rotate-v2'
    ) s;
  IF v_version <> 2 OR v_first_id <> v_second_id OR v_status <> 'active' THEN
    RAISE EXCEPTION 'Idempotent retry did not return the original version 2';
  END IF;
  SELECT count(*) INTO v_count FROM public.magnibox_imap_credentials
    WHERE organization_id=v_org AND mailbox_id=v_mailbox;
  IF v_count <> 2 THEN RAISE EXCEPTION 'Idempotent retry created a duplicate credential'; END IF;

  SELECT count(*) INTO v_count
    FROM public.magnibox_get_active_imap_credential(v_other_org, v_mailbox);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant credential lookup leaked a record'; END IF;

  SELECT public.magnibox_revoke_active_imap_credential(v_org, v_mailbox)
    INTO v_revoked;
  IF NOT v_revoked THEN RAISE EXCEPTION 'Active credential revocation returned false'; END IF;
  SELECT count(*) INTO v_count
    FROM public.magnibox_get_active_imap_credential(v_org, v_mailbox);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Revoked credential remains active'; END IF;

  SELECT public.magnibox_revoke_active_imap_credential(v_org, v_mailbox)
    INTO v_revoked;
  IF v_revoked THEN RAISE EXCEPTION 'Repeated revocation should be idempotent'; END IF;

  RAISE NOTICE 'PASS MAGNIBOX credential runtime: create, lookup, rotate, idempotent retry, tenant isolation and revoke';
END;
$credential_runtime$;

ROLLBACK;
