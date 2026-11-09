-- Structural and privilege checks for the fixed-asset accounting module.
DO $$
DECLARE
  v_code text;
  v_required text[] := ARRAY[
    '20','203','204','205','207','208','21','211','212','213','215','218',
    '22','221','222','223','225','228','229','23','232','237','238',
    '26','261','262','265','266','267','268','269',
    '27','271','272','273','274','275','276','277','279',
    '28','280','281','282','29','290','291','292','293','296','297',
    '404','462','652','681','752','781'
  ];
  v_table text;
BEGIN
  FOREACH v_code IN ARRAY v_required LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_code) THEN
      RAISE EXCEPTION 'PCG 2005 required account missing: %',v_code;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code IN ('675','775','6816','7816')) THEN
    RAISE EXCEPTION 'Non-PCG2005 lifecycle draft accounts remain in the chart';
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

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='fixed_asset_register_reconciliation') THEN
    RAISE EXCEPTION 'Register-to-ledger reconciliation view is missing';
  END IF;
END $$;
