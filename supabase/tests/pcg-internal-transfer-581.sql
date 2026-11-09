\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'user_id'::uuid, 'role', 'authenticated')::text,
  true
);

DO $test$
DECLARE
  v_org uuid;
  v_entry uuid := gen_random_uuid();
  v_transit_key text := 'TRANSIT:' || gen_random_uuid()::text;
  v_code text;
  v_status text;
BEGIN
  SELECT organization_id INTO STRICT v_org
  FROM public.organization_members
  WHERE user_id=auth.uid() AND status='active'
  ORDER BY created_at
  LIMIT 1;

  INSERT INTO public.journal_entries(
    id,organization_id,entry_date,reference,description,source_type,
    status,total_debit,total_credit,created_by
  )
  VALUES(
    v_entry,v_org,DATE '2026-11-01','CI-TRANSIT-'||replace(v_entry::text,'-',''),
    'PCG mapping regression test','internal_transfer_debit',
    'posted',100,100,auth.uid()
  );

  INSERT INTO public.journal_entry_lines(
    organization_id,journal_entry_id,account_key,account_label,debit,credit
  )
  VALUES
    (v_org,v_entry,v_transit_key,'Virement interne en transit',100,0),
    (v_org,v_entry,'PCG:512','Banques',0,100);

  SET CONSTRAINTS ALL IMMEDIATE;

  SELECT pcg_code,mapping_status
  INTO v_code,v_status
  FROM public.pcg2005_journal_lines
  WHERE journal_entry_id=v_entry AND account_key=v_transit_key;

  IF v_code IS DISTINCT FROM '581' OR v_status IS DISTINCT FROM 'automatique' THEN
    RAISE EXCEPTION 'Expected automatic PCG 581 mapping for TRANSIT account, got code %, status %',v_code,v_status;
  END IF;
END;
$test$;

ROLLBACK;

SELECT 'PASS internal transfer clearing maps automatically to PCG 581' AS result;
