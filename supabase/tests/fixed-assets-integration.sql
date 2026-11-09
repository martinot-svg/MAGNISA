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
  v_wip_impairment_id := public.magnisa_record_fixed_asset_impairment(
    v_org,v_wip,'2026-06-30',90000,'CI WIP impairment supported by recoverable amount evidence'
  );
  SELECT journal_entry_id INTO v_wip_impairment_journal
  FROM public.fixed_asset_impairments WHERE id=v_wip_impairment_id;
  IF v_wip_impairment_journal IS NULL THEN RAISE EXCEPTION 'WIP impairment journal was not posted'; END IF;

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
  IF NOT EXISTS (
    SELECT 1 FROM public.fixed_asset_depreciation_entries
    WHERE id=v_wip_depreciation_entry AND depreciation_charge>0
  ) THEN RAISE EXCEPTION 'WIP depreciation did not start after commissioning'; END IF;

  -- Acquisition posting is idempotent and creates one balanced PCG journal.
  v_acquisition_journal := public.magnisa_post_fixed_asset_acquisition(v_org,v_asset);
  IF public.magnisa_post_fixed_asset_acquisition(v_org,v_asset)<>v_acquisition_journal THEN
    RAISE EXCEPTION 'Acquisition posting is not idempotent';
  END IF;

  -- Plan and post depreciation, then reverse it without modifying the original journal.
  v_depreciation_entry := public.magnisa_plan_fixed_asset_depreciation(v_org,v_asset,'2026-01-01','2026-12-31');
  IF v_depreciation_entry IS NULL THEN RAISE EXCEPTION 'Depreciation plan was not created'; END IF;
  SELECT depreciation_charge INTO v_balance
  FROM public.fixed_asset_depreciation_entries
  WHERE id=v_depreciation_entry AND organization_id=v_org;
  IF coalesce(v_balance,0)<=0 THEN RAISE EXCEPTION 'Depreciation charge must be positive'; END IF;
  v_depreciation_journal := public.magnisa_post_fixed_asset_depreciation(v_org,v_depreciation_entry);
  IF v_depreciation_journal IS NULL THEN RAISE EXCEPTION 'Depreciation journal was not posted'; END IF;
  v_depreciation_reversal_journal := public.magnisa_reverse_fixed_asset_depreciation(
    v_org,v_depreciation_entry,'2026-12-31','CI test controlled depreciation reversal'
  );
  IF v_depreciation_reversal_journal IS NULL THEN RAISE EXCEPTION 'Depreciation reversal was not posted'; END IF;
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
  v_post_impairment_reversal_journal := public.magnisa_reverse_fixed_asset_depreciation(
    v_org,v_post_impairment_entry,'2027-12-31','CI test reversal of prospective post-impairment depreciation'
  );
  v_impairment_reversal_id := public.magnisa_reverse_fixed_asset_impairment(
    v_org,v_impairment_id,'2027-12-31','CI test reversal of impairment after recovery'
  );
  SELECT journal_entry_id INTO v_impairment_reversal_journal
  FROM public.fixed_asset_impairments WHERE id=v_impairment_reversal_id;
  IF v_impairment_reversal_journal IS NULL THEN RAISE EXCEPTION 'Impairment reversal journal was not posted'; END IF;

  -- Transfer is traceable and updates the existing register row.
  v_transfer_id := public.magnisa_transfer_fixed_asset(
    v_org,v_asset,'2026-12-31','CI Site B','CI Custodian','CI test location and custody transfer'
  );
  IF NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id=v_asset AND location='CI Site B' AND custodian='CI Custodian') THEN
    RAISE EXCEPTION 'Asset transfer did not update the register';
  END IF;

  -- Disposal derecognizes the asset and posts proceeds plus the loss.
  v_disposal_id := public.magnisa_dispose_fixed_asset(
    v_org,v_asset,'2026-12-31',100000,'CI test disposal with documented proceeds'
  );
  SELECT journal_entry_id INTO v_disposal_journal
  FROM public.fixed_asset_disposals WHERE id=v_disposal_id;
  IF v_disposal_journal IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.fixed_assets WHERE id=v_asset AND status='disposed' AND net_book_value=0
  ) THEN
    RAISE EXCEPTION 'Disposal did not derecognize the asset';
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
    v_wip_acquisition_journal,v_wip_impairment_journal,v_commissioning_journal
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
  WHERE organization_id=v_org AND account_code='215' AND reconciliation_status='reconciled';
  IF v_count=0 THEN RAISE EXCEPTION 'Fixed asset register does not reconcile to the PCG ledger'; END IF;
END $$;

RESET ROLE;
ROLLBACK;
