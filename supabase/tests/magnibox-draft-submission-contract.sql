-- Read-only contract for atomic outgoing draft submission.
DO $magnibox_draft_send$
DECLARE
  v_fn oid := to_regprocedure('public.orbit_reserve_magnibox_draft_send(uuid,uuid,uuid,uuid,uuid,integer)');
  v_def text;
BEGIN
  IF v_fn IS NULL THEN RAISE EXCEPTION 'MAGNIBOX draft submission RPC missing'; END IF;
  IF NOT has_function_privilege('service_role',v_fn,'EXECUTE')
    OR has_function_privilege('authenticated',v_fn,'EXECUTE')
    OR has_function_privilege('anon',v_fn,'EXECUTE')
    OR has_function_privilege('public',v_fn,'EXECUTE') THEN
    RAISE EXCEPTION 'Draft submission RPC must be service-role only';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_def;
  IF v_def NOT ILIKE '%for update%'
    OR v_def NOT ILIKE '%pg_advisory_xact_lock%'
    OR v_def NOT ILIKE '%scan_status <> ''available''%'
    OR v_def NOT ILIKE '%outbound quota exceeded%'
    OR v_def NOT ILIKE '%v_draft.request_key = p_request_key%' THEN
    RAISE EXCEPTION 'Draft submission must lock, enforce scanned attachments/quota and remain idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='private.orbit_limit_external_message_attachments()'::regprocedure
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%parent_status <> ''draft''%'
  ) THEN
    RAISE EXCEPTION 'Attachment inserts must be fenced after draft submission';
  END IF;
  RAISE NOTICE 'PASS MAGNIBOX draft submission: row lock, idempotency, scan gate, quota, attachment fencing';
END
$magnibox_draft_send$;
