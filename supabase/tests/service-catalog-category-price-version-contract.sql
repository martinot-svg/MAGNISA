-- Contract tests for the additive service catalogue upgrade.
DO $catalog_contract$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.service_categories') IS NULL THEN
    RAISE EXCEPTION 'service_categories table is missing';
  END IF;
  IF to_regclass('public.service_price_versions') IS NULL THEN
    RAISE EXCEPTION 'service_price_versions table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.services'::regclass
      AND attname='category_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'services.category_id is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.service_categories'::regclass) THEN
    RAISE EXCEPTION 'service_categories RLS is not enabled';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.service_price_versions'::regclass) THEN
    RAISE EXCEPTION 'service_price_versions RLS is not enabled';
  END IF;

  v_function := 'public.create_service_catalog_item(uuid,text,text,uuid,text,numeric,numeric,text,text,integer)'::regprocedure;
  IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to invoke create_service_catalog_item';
  END IF;
  IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not invoke create_service_catalog_item';
  END IF;

  v_function := 'public.update_service_catalog_item(uuid,uuid,text,text,uuid,text,numeric,numeric,text,text,integer)'::regprocedure;
  IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must be able to invoke update_service_catalog_item';
  END IF;
  IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not invoke update_service_catalog_item';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.services'::regclass
      AND conname='services_category_org_fk'
  ) THEN
    RAISE EXCEPTION 'organization-scoped category foreign key is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='service_price_versions'
      AND indexname='service_price_versions_one_current'
  ) THEN
    RAISE EXCEPTION 'unique current price index is missing';
  END IF;
END
$catalog_contract$;
