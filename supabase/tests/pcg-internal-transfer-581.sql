\set ON_ERROR_STOP on
BEGIN;

-- Keep this SQL regression self-contained: create an isolated tenant and
-- authenticated identity inside the transaction, then roll everything back.
SELECT gen_random_uuid() AS test_user_id, gen_random_uuid() AS test_org_id \gset

INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
  :'test_user_id'::uuid,'authenticated','authenticated',
  :'test_user_id'||'@pcg581.test','',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.organizations(id,name)
VALUES (:'test_org_id'::uuid,'PCG 581 mapping regression test');

INSERT INTO public.organization_members(organization_id,user_id,role,status)
VALUES (:'test_org_id'::uuid,:'test_user_id'::uuid,'owner','active');

SELECT set_config('request.jwt.claim.sub', :'test_user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'test_user_id'::uuid, 'role', 'authenticated')::text,
  true
);

DO $test$
DECLARE
  v_org uuid := (SELECT organization_id FROM public.organization_members WHERE user_id=auth.uid() AND status='active' ORDER BY created_at LIMIT 1);
  v_entry uuid := gen_random_uuid();
  v_transit_key text := 'TRANSIT:' || gen_random_uuid()::text;
  v_code text;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_org) THEN
    RAISE EXCEPTION 'Isolated authenticated organization fixture was not established';
  END IF;

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