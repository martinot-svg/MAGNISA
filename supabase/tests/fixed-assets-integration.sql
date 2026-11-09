-- End-to-end accounting tests for the fixed-asset lifecycle.
-- Runs only against the disposable local Supabase database and rolls back every fixture and journal.
\set ON_ERROR_STOP on
\set org_id 'e1000000-0000-4000-8000-000000000001'
\set asset_id 'e1000000-0000-4000-8000-000000000021'
\set component_parent_id 'e1000000-0000-4000-8000-000000000022'
\set wip_asset_id 'e1000000-0000-4000-8000-000000000023'

BEGIN;

INSERT INTO public.fixed_assets (
  id,organization_id,asset_code,name,category,acquisition_date,in_service_date,
  acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,depreciation_method,
  pcg_asset_account_code,pcg_acquisition_counterpart_account_code,
  pcg_accumulated_depreciation_account_code,pcg_depreciation_expense_account_code,
  pcg_impairment_account_code,pcg_impairment_expense_account_code,pcg_impairment_reversal_income_account_code,
  pcg_disposal_receivable_account_code,pcg_disposal_expense_account_code,pcg_disposal_income_account_code,
  accumulated_depreciation,impairment_loss,net_book_value,status
) VALUES
  (:'asset_id'::uuid,:'org_id'::uuid,'CI-IMM-POST-01','CI asset lifecycle','equipment','2026-01-01','2026-01-01',
   120000,0,0,24,'straight_line','215','404','281','681','291','681','781','462','652','752',0,0,120000,'active'),
  (:'component_parent_id'::uuid,:'org_id'::uuid,'CI-IMM-COMP-01','CI component parent','equipment','2026-01-01','2026-01-01',
   100000,0,0,120,'straight_line','215','72','281','681','291','681','781','462','652','752',0,0,100000,'active'),
  (:'wip_asset_id'::uuid,:'org_id'::uuid,'CI-IMM-WIP-01','CI work in progress','construction','2026-01-01',NULL,
   100000,0,0,NULL,'none','232','404',NULL,NULL,'293','681','781','462','652','752',0,0,100000,'active');

SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'user_id'::uuid, 'role', 'authenticated')::text,
  true
);

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org uuid := 'e1000000-0000-4000-8000-000000000001';
  v_asset uuid := 'e1000000-0000-4000-8000-000000000021';
  v_component_parent uuid := 'e1000000-0000-4000-8000-000000000022';
  v_wip uuid := 'e1000000-0000-4000-8000-000000000023';
  v_wip_acquisition_journal uuid;
  v_wip_impairment_id uuid;
  v_wip_impairment_journal uuid;
  v_commissioning_id uuid;
  v_commissioning_journal uuid;
  v_wip_depreciation_entry uuid;
  v_wip_depreciation_journal uuid;
  v_acquisition_journal uuid;
  v_depreciation_entry uuid;
  v_depreciation_journal uuid;
  v_depreciation_reversal_journal uuid;
  v_impairment_id uuid;
  v_impairment_journal uuid;
  v_impairment_reversal_id uuid;
  v_post_impairment_entry uuid;
  v_post_impairment_journal uuid;
  v_post_impairment_reversal_journal uuid;
  v_impairment_reversal_journal uuid;
  v_transfer_id uuid;
  v_disposal_id uuid;
  v_disposal_journal uuid;
  v_componentization_id uuid;
  v_componentization_journal uuid;
  v_component_acquisition_journal uuid;
  v_component_id uuid;
  v_ifrs_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_balance numeric;
  v_count integer;
  v_journal uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated test JWT is missing'; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Test user is not an active organization member'; END IF;

  -- Class-23 work in progress remains non-depreciable until commissioning.
  v_wip_acquisition_journal := public.magnisa_post_fixed_asset_acquisition(v_org,v_wip);
  IF v_wip_acquisition_journal IS NULL THEN RAISE EXCEPTION 'WIP acquisition journal was not posted'; END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_acquisition_journal AND account_key='PCG:232')<>100000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_acquisition_journal AND account_key='PCG:404')<>100000 THEN
    RAISE EXCEPTION 'WIP acquisition must debit PCG 232 and credit PCG 404 for 100000 MGA';
  END IF;
  v_wip_impairment_id := public.magnisa_record_fixed_asset_impairment(
    v_org,v_wip,'2026-06-30',90000,'CI WIP impairment supported by recoverable amount evidence'
  );
  SELECT journal_entry_id INTO v_wip_impairment_journal
  FROM public.fixed_asset_impairments WHERE id=v_wip_impairment_id;
  IF v_wip_impairment_journal IS NULL THEN RAISE EXCEPTION 'WIP impairment journal was not posted'; END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_impairment_journal AND account_key='PCG:681')<>10000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_impairment_journal AND account_key='PCG:293')<>10000 THEN
    RAISE EXCEPTION 'WIP impairment must debit PCG 681 and credit PCG 293 for 10000 MGA';
  END IF;

  BEGIN
    PERFORM public.magnisa_plan_fixed_asset_depreciation(v_org,v_wip,'2026-01-01','2026-06-30');
    RAISE EXCEPTION 'WIP depreciation before commissioning should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='WIP depreciation before commissioning should be rejected' THEN RAISE; END IF;
  END;

  v_commissioning_id := public.magnisa_commission_fixed_asset(
    v_org,v_wip,'2026-07-01','215','straight_line',24,'281','681','291',
    'CI WIP commissioning after acceptance and commissioning report'
  );
  SELECT journal_entry_id INTO v_commissioning_journal
  FROM public.fixed_asset_commissionings WHERE id=v_commissioning_id;
  IF v_commissioning_journal IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.fixed_assets
    WHERE id=v_wip AND pcg_asset_account_code='215' AND in_service_date='2026-07-01'
      AND depreciation_method='straight_line' AND useful_life_months=24
      AND pcg_impairment_account_code='291' AND impairment_loss=10000
      AND net_book_value=90000
  ) THEN RAISE EXCEPTION 'WIP commissioning did not reclassify the register and preserve impairment'; END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_commissioning_journal AND account_key='PCG:215')<>100000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_commissioning_journal AND account_key='PCG:232')<>100000
     OR (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_commissioning_journal AND account_key='PCG:293')<>10000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_commissioning_journal AND account_key='PCG:291')<>10000 THEN
    RAISE EXCEPTION 'WIP commissioning journal must reclassify 232 to 215 and 293 to 291 at exact carrying amounts';
  END IF;
  BEGIN
    PERFORM public.magnisa_commission_fixed_asset(
      v_org,v_wip,'2026-07-01','215','straight_line',24,'281','681','291',
      'CI repeated commissioning attempt'
    );
    RAISE EXCEPTION 'Duplicate commissioning should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Duplicate commissioning should be rejected' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.magnisa_plan_fixed_asset_depreciation(v_org,v_wip,'2026-01-01','2026-06-30');
    RAISE EXCEPTION 'Pre-commissioning depreciation period should be rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Pre-commissioning depreciation period should be rejected' THEN RAISE; END IF;
  END;
  v_wip_depreciation_entry := public.magnisa_plan_fixed_asset_depreciation(
    v_org,v_wip,'2026-07-01','2026-12-31'
  );
  SELECT depreciation_charge INTO v_balance FROM public.fixed_asset_depreciation_entries
  WHERE id=v_wip_depreciation_entry;
  IF v_balance<>22500 THEN
    RAISE EXCEPTION 'WIP depreciation must be 22500 MGA for six months after 2026-07-01; got %',v_balance;
  END IF;
  v_wip_depreciation_journal := public.magnisa_post_fixed_asset_depreciation(v_org,v_wip_depreciation_entry);
  IF public.magnisa_post_fixed_asset_depreciation(v_org,v_wip_depreciation_entry)<>v_wip_depreciation_journal THEN
    RAISE EXCEPTION 'WIP depreciation posting is not idempotent';
  END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_depreciation_journal AND account_key='PCG:681')<>22500
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_wip_depreciation_journal AND account_key='PCG:281')<>22500
     OR NOT EXISTS (SELECT 1 FROM public.fixed_assets
       WHERE id=v_wip AND accumulated_depreciation=22500 AND impairment_loss=10000 AND net_book_value=67500) THEN
    RAISE EXCEPTION 'Post-commissioning depreciation journal or register balance is inconsistent';
  END IF;

  -- Acquisition posting is idempotent and creates one balanced PCG journal.
  v_acquisition_journal := public.magnisa_post_fixed_asset_acquisition(v_org,v_asset);
  IF public.magnisa_post_fixed_asset_acquisition(v_org,v_asset)<>v_acquisition_journal THEN
    RAISE EXCEPTION 'Acquisition posting is not idempotent';
  END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_acquisition_journal AND account_key='PCG:215')<>120000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_acquisition_journal AND account_key='PCG:404')<>120000 THEN
    RAISE EXCEPTION 'Asset acquisition must debit PCG 215 and credit PCG 404 for 120000 MGA';
  END IF;

  -- Plan and post depreciation, then reverse it without modifying the original journal.
  v_depreciation_entry := public.magnisa_plan_fixed_asset_depreciation(v_org,v_asset,'2026-01-01','2026-12-31');
  IF v_depreciation_entry IS NULL THEN RAISE EXCEPTION 'Depreciation plan was not created'; END IF;
  SELECT depreciation_charge INTO v_balance
  FROM public.fixed_asset_depreciation_entries
  WHERE id=v_depreciation_entry AND organization_id=v_org;
  IF v_balance<>60000 THEN RAISE EXCEPTION '2026 depreciation must be 60000 MGA for 12 of 24 months; got %',v_balance; END IF;
  v_depreciation_journal := public.magnisa_post_fixed_asset_depreciation(v_org,v_depreciation_entry);
  IF v_depreciation_journal IS NULL THEN RAISE EXCEPTION 'Depreciation journal was not posted'; END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_depreciation_journal AND account_key='PCG:681')<>60000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_depreciation_journal AND account_key='PCG:281')<>60000 THEN
    RAISE EXCEPTION 'Depreciation must debit PCG 681 and credit PCG 281 for 60000 MGA';
  END IF;
  v_depreciation_reversal_journal := public.magnisa_reverse_fixed_asset_depreciation(
    v_org,v_depreciation_entry,'2026-12-31','CI test controlled depreciation reversal'
  );
  IF v_depreciation_reversal_journal IS NULL THEN RAISE EXCEPTION 'Depreciation reversal was not posted'; END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_depreciation_reversal_journal AND account_key='PCG:281')<>60000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_depreciation_reversal_journal AND account_key='PCG:681')<>60000 THEN
    RAISE EXCEPTION 'Depreciation reversal must debit PCG 281 and credit PCG 681 for 60000 MGA';
  END IF;
  IF (SELECT status FROM public.fixed_asset_depreciation_entries WHERE id=v_depreciation_entry)<>'reversed' THEN
    RAISE EXCEPTION 'Depreciation schedule did not move to reversed status';
  END IF;

  -- Impairment and its reversal create separate balanced journals.
  v_impairment_id := public.magnisa_record_fixed_asset_impairment(
    v_org,v_asset,'2026-12-31',90000,'CI test impairment with recoverable value evidence'
  );
  SELECT journal_entry_id INTO v_impairment_journal
  FROM public.fixed_asset_impairments WHERE id=v_impairment_id;
  IF v_impairment_journal IS NULL THEN RAISE EXCEPTION 'Impairment journal was not posted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fixed_asset_impairments
      WHERE id=v_impairment_id AND event_type='impairment' AND event_date='2026-12-31' AND amount=30000) THEN
    RAISE EXCEPTION 'Impairment must be 30000 MGA on 2026-12-31 to reduce 120000 MGA to recoverable value 90000 MGA';
  END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_impairment_journal AND account_key='PCG:681')<>30000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_impairment_journal AND account_key='PCG:291')<>30000 THEN
    RAISE EXCEPTION 'Impairment must debit PCG 681 and credit PCG 291 for 30000 MGA';
  END IF;
  -- Future depreciation must use the impaired carrying amount over the remaining useful life.
  v_post_impairment_entry := public.magnisa_plan_fixed_asset_depreciation(
    v_org,v_asset,'2027-01-01','2027-12-31'
  );
  SELECT depreciation_charge INTO v_balance
  FROM public.fixed_asset_depreciation_entries WHERE id=v_post_impairment_entry;
  IF v_balance<>90000 THEN
    RAISE EXCEPTION 'Post-impairment depreciation should be 90000 over the remaining useful life; got %',v_balance;
  END IF;
  v_post_impairment_journal := public.magnisa_post_fixed_asset_depreciation(v_org,v_post_impairment_entry);
  IF v_post_impairment_journal IS NULL
     OR (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
         WHERE organization_id=v_org AND journal_entry_id=v_post_impairment_journal AND account_key='PCG:681')<>90000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
         WHERE organization_id=v_org AND journal_entry_id=v_post_impairment_journal AND account_key='PCG:281')<>90000 THEN
    RAISE EXCEPTION 'Post-impairment depreciation must debit PCG 681 and credit PCG 281 for 90000 MGA';
  END IF;
  v_post_impairment_reversal_journal := public.magnisa_reverse_fixed_asset_depreciation(
    v_org,v_post_impairment_entry,'2027-12-31','CI test reversal of prospective post-impairment depreciation'
  );
  IF v_post_impairment_reversal_journal IS NULL
     OR (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
         WHERE organization_id=v_org AND journal_entry_id=v_post_impairment_reversal_journal AND account_key='PCG:281')<>90000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
         WHERE organization_id=v_org AND journal_entry_id=v_post_impairment_reversal_journal AND account_key='PCG:681')<>90000 THEN
    RAISE EXCEPTION 'Post-impairment depreciation reversal must debit PCG 281 and credit PCG 681 for 90000 MGA';
  END IF;
  v_impairment_reversal_id := public.magnisa_reverse_fixed_asset_impairment(
    v_org,v_impairment_id,'2027-12-31','CI test reversal of impairment after recovery'
  );
  SELECT journal_entry_id INTO v_impairment_reversal_journal
  FROM public.fixed_asset_impairments WHERE id=v_impairment_reversal_id;
  IF v_impairment_reversal_journal IS NULL THEN RAISE EXCEPTION 'Impairment reversal journal was not posted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fixed_asset_impairments
      WHERE id=v_impairment_reversal_id AND event_type='reversal'
        AND event_date='2027-12-31' AND amount=30000) THEN
    RAISE EXCEPTION 'Impairment reversal must restore 30000 MGA on 2027-12-31';
  END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_impairment_reversal_journal AND account_key='PCG:291')<>30000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_impairment_reversal_journal AND account_key='PCG:781')<>30000 THEN
    RAISE EXCEPTION 'Impairment reversal must debit PCG 291 and credit PCG 781 for 30000 MGA';
  END IF;

  -- Transfer is traceable and updates the existing register row.
  v_transfer_id := public.magnisa_transfer_fixed_asset(
    v_org,v_asset,'2027-12-31','CI Site B','CI Custodian','CI test location and custody transfer'
  );
  IF NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id=v_asset AND location='CI Site B' AND custodian='CI Custodian') THEN
    RAISE EXCEPTION 'Asset transfer did not update the register';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fixed_asset_transfers
      WHERE id=v_transfer_id AND transfer_date='2027-12-31'
        AND new_location='CI Site B' AND new_custodian='CI Custodian') THEN
    RAISE EXCEPTION 'Transfer history must preserve its date, destination and custodian';
  END IF;

  IF position('652 et 752' IN pg_get_functiondef('public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text)'::regprocedure))=0
     OR position('675 et 775' IN pg_get_functiondef('public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text)'::regprocedure))>0 THEN
    RAISE EXCEPTION 'Fixed asset disposal validation must refer to PCG 652 and 752, not legacy 675 and 775';
  END IF;

  -- Disposal derecognizes the asset and posts proceeds plus the loss.
  v_disposal_id := public.magnisa_dispose_fixed_asset(
    v_org,v_asset,'2027-12-31',100000,'CI test disposal with documented proceeds'
  );
  SELECT journal_entry_id INTO v_disposal_journal
  FROM public.fixed_asset_disposals WHERE id=v_disposal_id;
  IF v_disposal_journal IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.fixed_assets WHERE id=v_asset AND status='disposed' AND net_book_value=0
  ) THEN
    RAISE EXCEPTION 'Disposal did not derecognize the asset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fixed_asset_disposals
      WHERE id=v_disposal_id AND disposal_date='2027-12-31' AND proceeds=100000
        AND carrying_amount=120000 AND gain=0 AND loss=20000) THEN
    RAISE EXCEPTION 'Disposal must derecognize 120000 MGA at proceeds 100000 MGA and loss 20000 MGA';
  END IF;
  IF (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_disposal_journal AND account_key='PCG:462')<>100000
     OR (SELECT coalesce(sum(debit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_disposal_journal AND account_key='PCG:652')<>20000
     OR (SELECT coalesce(sum(credit),0) FROM public.journal_entry_lines
      WHERE organization_id=v_org AND journal_entry_id=v_disposal_journal AND account_key='PCG:215')<>120000 THEN
    RAISE EXCEPTION 'Disposal journal must debit PCG 462 for 100000, debit PCG 652 for 20000 and credit PCG 215 for 120000 MGA';
  END IF;

  -- Componentization reclassifies one parent into two child components in the same register.
  v_component_acquisition_journal := public.magnisa_post_fixed_asset_acquisition(v_org,v_component_parent);
  v_componentization_id := public.magnisa_componentize_fixed_asset(
    v_org,v_component_parent,'2026-12-31',
    jsonb_build_array(
      jsonb_build_object('asset_code','CI-IMM-COMP-A','name','CI component A','category','equipment',
        'acquisition_cost',60000,'directly_attributable_cost',0,'residual_value',0,'accumulated_depreciation',0,'impairment_loss',0,
        'useful_life_months',60,'depreciation_method','straight_line','pcg_asset_account_code','215',
        'pcg_accumulated_depreciation_account_code','281','pcg_depreciation_expense_account_code','681',
        'pcg_impairment_account_code','291','pcg_impairment_expense_account_code','681',
        'pcg_impairment_reversal_income_account_code','781','pcg_disposal_receivable_account_code','462',
        'pcg_disposal_expense_account_code','652','pcg_disposal_income_account_code','752'),
      jsonb_build_object('asset_code','CI-IMM-COMP-B','name','CI component B','category','equipment',
        'acquisition_cost',40000,'directly_attributable_cost',0,'residual_value',0,'accumulated_depreciation',0,'impairment_loss',0,
        'useful_life_months',120,'depreciation_method','straight_line','pcg_asset_account_code','215',
        'pcg_accumulated_depreciation_account_code','281','pcg_depreciation_expense_account_code','681',
        'pcg_impairment_account_code','291','pcg_impairment_expense_account_code','681',
        'pcg_impairment_reversal_income_account_code','781','pcg_disposal_receivable_account_code','462',
        'pcg_disposal_expense_account_code','652','pcg_disposal_income_account_code','752')
    ),
    'CI test component allocation based on component-level useful lives'
  );
  SELECT journal_entry_id INTO v_componentization_journal
  FROM public.fixed_asset_componentizations WHERE id=v_componentization_id;
  IF v_componentization_journal IS NULL THEN RAISE EXCEPTION 'Component reclassification journal was not posted'; END IF;
  SELECT count(*) INTO v_count FROM public.fixed_assets
  WHERE organization_id=v_org AND parent_asset_id=v_component_parent;
  IF v_count<>2 OR NOT EXISTS (
    SELECT 1 FROM public.fixed_assets WHERE id=v_component_parent AND component_reference='componentized_parent' AND acquisition_cost=0
  ) THEN RAISE EXCEPTION 'Component register hierarchy is incomplete'; END IF;

  -- IFRS adjustments are approved and reversed separately without a statutory journal.
  SELECT id INTO v_component_id FROM public.fixed_assets
  WHERE organization_id=v_org AND asset_code='CI-IMM-COMP-A';
  INSERT INTO public.fixed_asset_ifrs_adjustments(
    organization_id,fixed_asset_id,adjustment_date,standard_reference,adjustment_type,
    statutory_carrying_amount,ifrs_carrying_amount,reason,supporting_reference,created_by
  ) VALUES (
    v_org,v_component_id,'2026-12-31','IAS 16','useful_life',60000,55000,
    'CI test IFRS useful life difference and justification','CI-IFRS-TEST',auth.uid()
  ) RETURNING id INTO v_ifrs_id;
  PERFORM public.magnisa_approve_fixed_asset_ifrs_adjustment(v_org,v_ifrs_id);
  PERFORM public.magnisa_reverse_fixed_asset_ifrs_adjustment(
    v_org,v_ifrs_id,'CI test IFRS adjustment reversal with audit trail'
  );
  IF (SELECT status FROM public.fixed_asset_ifrs_adjustments WHERE id=v_ifrs_id)<>'reversed' THEN
    RAISE EXCEPTION 'IFRS adjustment reversal did not persist';
  END IF;

  -- Every journal created by the tested workflows must balance debit and credit.
  FOREACH v_journal IN ARRAY ARRAY[
    v_acquisition_journal,v_depreciation_journal,v_depreciation_reversal_journal,
    v_impairment_journal,v_post_impairment_journal,v_post_impairment_reversal_journal,
    v_impairment_reversal_journal,v_disposal_journal,
    v_component_acquisition_journal,v_componentization_journal,
    v_wip_acquisition_journal,v_wip_impairment_journal,v_commissioning_journal,v_wip_depreciation_journal
  ] LOOP
    SELECT coalesce(sum(debit),0),coalesce(sum(credit),0)
      INTO v_debit,v_credit
    FROM public.journal_entry_lines
    WHERE organization_id=v_org AND journal_entry_id=v_journal;
    IF abs(v_debit-v_credit)>0.01 THEN
      RAISE EXCEPTION 'Unbalanced fixed-asset journal %: debit %, credit %',v_journal,v_debit,v_credit;
    END IF;
  END LOOP;

  -- The net register-to-ledger balance for the component asset account must reconcile.
  SELECT count(*) INTO v_count
  FROM public.fixed_asset_register_reconciliation
  WHERE organization_id=v_org AND account_code IN ('215','281','291') AND reconciliation_status='reconciled';
  IF v_count<>3 THEN RAISE EXCEPTION 'Fixed asset gross cost, depreciation and impairment balances do not reconcile to the PCG ledger'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
