-- Supplier invoice three-way matching invariants.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE v_def text; v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['supplier_invoice_matches','supplier_invoice_match_lines'] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN
      RAISE EXCEPTION 'Missing supplier invoice matching table: %',v_table;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||v_table)) THEN
      RAISE EXCEPTION 'RLS is disabled on %',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT')
       OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE')
       OR has_table_privilege('anon','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access is exposed on %',v_table;
    END IF;
  END LOOP;
  SELECT pg_get_functiondef('public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)'::regprocedure) INTO v_def;
  IF position('assert_org_access' in v_def)=0 OR position('assert_org_permission' in v_def)=0
     OR position('FOR UPDATE' in v_def)=0 OR position('quantity_invoiced' in v_def)=0
     OR position('line_subtotal' in v_def)=0 OR position('variance_reason' in v_def)=0 THEN
    RAISE EXCEPTION 'Supplier invoice matching controls are incomplete';
  END IF;
  IF has_function_privilege('anon','public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Supplier invoice matching RPC grants are incorrect';
  END IF;
  IF to_regclass('public.magnisa_supplier_invoice_match_reconciliation') IS NULL THEN
    RAISE EXCEPTION 'Supplier invoice match reconciliation view is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='supplier_invoice_matches_invoice_order_uidx') THEN
    RAISE EXCEPTION 'Supplier invoices must support several purchase-order matches';
  END IF;
END $$;
ROLLBACK;
