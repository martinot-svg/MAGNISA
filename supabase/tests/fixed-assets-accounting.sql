-- Structural and privilege checks for the fixed-asset accounting module.
DO $$
DECLARE
  v_code text;
  v_required text[] := ARRAY[
    '20','203','204','205','207','208','21','211','212','213','215','218',
    '22','221','222','223','225','228','229','23','232','237','238',
    '26','261','262','265','266','267','268','269','229',
    '27','271','272','273','274','275','276','277','279',
    '28','280','281','282','29','290','291','292','293','296','297',
    '72','404','405','462','652','681','752','781'
  ];
  v_table text;
BEGIN
  FOREACH v_code IN ARRAY v_required LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_code) THEN
      RAISE EXCEPTION 'PCG 2005 required account missing: %',v_code;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='229' AND kind='liability') THEN
    RAISE EXCEPTION 'PCG 229 rights of grantor must be classified as a liability';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='72' AND kind='income') THEN
    RAISE EXCEPTION 'PCG 72 production immobilisée must be available as an acquisition counterpart';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_assets WHERE pcg_asset_account_code LIKE '229%') THEN
    RAISE EXCEPTION 'A fixed asset must not be mapped to PCG 229 rights of grantor';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'fixed_asset_depreciation_entries','fixed_asset_impairments',
    'fixed_asset_disposals','fixed_asset_transfers',
    'fixed_asset_ifrs_adjustments','fixed_asset_componentizations'
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||v_table)::regclass) THEN
      RAISE EXCEPTION 'RLS is not enabled on %',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') THEN
      RAISE EXCEPTION 'anon must not read %',v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated','public.fixed_asset_depreciation_entries','INSERT')
     OR has_table_privilege('authenticated','public.fixed_asset_depreciation_entries','UPDATE') THEN
    RAISE EXCEPTION 'Depreciation schedules must be mutated only through validated RPCs';
  END IF;

  IF NOT has_function_privilege('authenticated','public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_post_fixed_asset_depreciation(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_post_fixed_asset_acquisition(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_reverse_fixed_asset_depreciation(uuid,uuid,date,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_reverse_fixed_asset_ifrs_adjustment(uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_record_fixed_asset_impairment(uuid,uuid,date,numeric,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_transfer_fixed_asset(uuid,uuid,date,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_componentize_fixed_asset(uuid,uuid,date,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.magnisa_approve_fixed_asset_ifrs_adjustment(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'A required fixed-asset RPC is not executable by authenticated users';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fixed_asset_depreciation_origin_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fixed_asset_impairment_origin_guard' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fixed_asset_disposal_origin_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Posting-origin guards are missing';
  END IF;


  IF abs(public.magnisa_fixed_asset_month_units(
      DATE '2025-01-01',DATE '2025-07-01',DATE '2026-01-01',12
    )-6)>0.000001 THEN
    RAISE EXCEPTION 'Prospective depreciation month units are incorrect';
  END IF;
  IF public.magnisa_fixed_asset_period_charge(
      300,0,DATE '2025-01-01',12,DATE '2025-07-01',DATE '2025-12-31'
    )<>300 THEN
    RAISE EXCEPTION 'Post-impairment depreciation must allocate the revised carrying amount over remaining useful life';
  END IF;
  IF public.magnisa_fixed_asset_period_charge(
      150,200,DATE '2025-01-01',12,DATE '2025-07-01',DATE '2025-12-31'
    )<>0 THEN
    RAISE EXCEPTION 'Depreciation must not restore an impaired carrying amount below residual value';
  END IF;
  IF position('opening_net_book_value' IN pg_get_functiondef(
      'public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date)'::regprocedure
    ))=0 OR position('magnisa_fixed_asset_period_charge' IN pg_get_functiondef(
      'public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date)'::regprocedure
    ))=0 THEN
    RAISE EXCEPTION 'Depreciation planning does not use the prospective post-impairment basis';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='fixed_asset_register_reconciliation') THEN
    RAISE EXCEPTION 'Register-to-ledger reconciliation view is missing';
  END IF;
  IF position('PCG:%' IN pg_get_viewdef('public.pcg2005_journal_lines'::regclass,true))=0 THEN
    RAISE EXCEPTION 'Direct PCG journal keys are not mapped into the PCG trial balance';
  END IF;
  IF position('ledger_net' IN pg_get_viewdef('public.fixed_asset_register_reconciliation'::regclass,true))=0 THEN
    RAISE EXCEPTION 'Fixed asset reconciliation must compare net ledger balances';
  END IF;
END $$;
