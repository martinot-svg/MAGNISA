DO $contract$
DECLARE
  v_check text;
BEGIN
  SELECT with_check INTO STRICT v_check
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename='magnibox_internal_drafts'
    AND policyname='magnibox_internal_drafts_update'
    AND cmd='UPDATE';

  IF v_check ILIKE '%r.organization_id = r.organization_id%' THEN
    RAISE EXCEPTION 'Internal draft recipient policy contains a tautological tenant comparison';
  END IF;
  IF v_check NOT ILIKE '%r.organization_id = magnibox_internal_drafts.organization_id%' THEN
    RAISE EXCEPTION 'Internal draft recipient mailbox must belong to the draft organization';
  END IF;
  IF v_check NOT ILIKE '%magnibox_has_internal_access%'
     OR v_check NOT ILIKE '%created_by%' THEN
    RAISE EXCEPTION 'Internal draft update must retain sender authorization and creator ownership';
  END IF;
END;
$contract$;
