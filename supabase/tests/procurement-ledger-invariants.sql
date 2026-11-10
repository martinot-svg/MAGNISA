-- Structural assertions for the procurement and perpetual stock foundation.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  v_table text;
  v_definition text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'catalog_items','stock_locations','purchase_orders','purchase_order_lines',
    'goods_receipts','goods_receipt_lines','stock_movements'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN
      RAISE EXCEPTION 'Procurement table public.% is missing',v_table;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||v_table)) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%',v_table;
    END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT')
       OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE')
       OR has_table_privilege('anon','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access is exposed on public.%',v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='stock_movements_organization_id_event_key_key'
  ) THEN RAISE EXCEPTION 'Stock movement event idempotency constraint is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='goods_receipts_org_request_key_uidx'
  ) THEN RAISE EXCEPTION 'Goods receipt request idempotency index is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='stock_movements_immutable' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Stock movement append-only guard is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname='public' AND viewname='stock_on_hand'
  ) THEN RAISE EXCEPTION 'Stock on hand view is missing'; END IF;

  SELECT pg_get_functiondef('public.post_goods_receipt(uuid)'::regprocedure) INTO v_definition;
  IF position('private.post_goods_receipt' in v_definition)=0 THEN
    RAISE EXCEPTION 'Public receipt RPC wrapper is missing the private controlled workflow';
  END IF;
  SELECT pg_get_functiondef('private.post_goods_receipt(uuid)'::regprocedure) INTO v_definition;
  IF position('customer_mandate' in v_definition)=0
     OR position('company_bears_goods_risk' in v_definition)=0
     OR position('quantity_received' in v_definition)=0
     OR position('FOR UPDATE' in v_definition)=0 THEN
    RAISE EXCEPTION 'Receipt mandate, quantity or concurrency guards are missing';
  END IF;
  IF has_function_privilege('anon','public.post_goods_receipt(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.post_goods_receipt(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Receipt RPC grants are incorrect';
  END IF;
END $$;

DO $supplier_match$
DECLARE v_def text; v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['supplier_invoice_matches','supplier_invoice_match_lines'] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN RAISE EXCEPTION 'Missing supplier invoice matching table: %',v_table; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||v_table)) THEN RAISE EXCEPTION 'RLS disabled on %',v_table; END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE') OR has_table_privilege('anon','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access exposed on %',v_table;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='reconciliation_scope') THEN
    RAISE EXCEPTION 'Supplier invoice reconciliation scope is missing';
  END IF;
  SELECT pg_get_functiondef('public.record_supplier_invoice_with_scope(uuid,uuid,text,date,date,numeric,text,text)'::regprocedure) INTO v_def;
  IF position('reconciliation_scope' in v_def)=0 OR position('record_supplier_invoice' in v_def)=0 THEN
    RAISE EXCEPTION 'Supplier invoice classification wrapper is incomplete';
  END IF;
  IF has_function_privilege('anon','public.record_supplier_invoice_with_scope(uuid,uuid,text,date,date,numeric,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.record_supplier_invoice_with_scope(uuid,uuid,text,date,date,numeric,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Supplier invoice classification RPC grants are incorrect';
  END IF;
  SELECT pg_get_functiondef('public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)'::regprocedure) INTO v_def;
  IF position('assert_org_access' in v_def)=0 OR position('assert_org_permission' in v_def)=0
     OR position('FOR UPDATE' in v_def)=0 OR position('quantity_invoiced' in v_def)=0
     OR position('line_subtotal' in v_def)=0 OR position('variance_reason' in v_def)=0 THEN
    RAISE EXCEPTION 'Supplier invoice three-way matching controls are incomplete';
  END IF;
  IF has_function_privilege('anon','public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reconcile_supplier_invoice_to_receipts(uuid,uuid,uuid,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Supplier invoice matching RPC grants are incorrect';
  END IF;
  IF to_regclass('public.magnisa_supplier_invoice_match_reconciliation') IS NULL THEN
    RAISE EXCEPTION 'Supplier invoice matching diagnostic view is missing';
  END IF;
  SELECT pg_get_functiondef('public.reconcile_supplier_invoice_to_posted_receipts(uuid,uuid,uuid,text)'::regprocedure) INTO v_def;
  IF position('goods_receipt_lines' in v_def)=0 OR position('quantity_remaining' in v_def)=0
     OR position('reconcile_supplier_invoice_to_receipts' in v_def)=0 THEN
    RAISE EXCEPTION 'Automatic supplier invoice matching from posted receipts is incomplete';
  END IF;
  IF has_function_privilege('anon','public.reconcile_supplier_invoice_to_posted_receipts(uuid,uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reconcile_supplier_invoice_to_posted_receipts(uuid,uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Automatic supplier invoice matching RPC grants are incorrect';
  END IF;
END
$supplier_match$;


DO $supplier_tax_multi_mandate$
DECLARE v_def text; v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['customer_mandate_disbursements','customer_mandate_reimbursements'] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN RAISE EXCEPTION 'Missing mandate settlement table %',v_table; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||v_table)) THEN RAISE EXCEPTION 'RLS disabled on %',v_table; END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') OR has_table_privilege('anon','public.'||v_table,'INSERT')
       OR has_table_privilege('anon','public.'||v_table,'UPDATE') OR has_table_privilege('anon','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access exposed on %',v_table;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='supplier_invoice_matches_invoice_order_uidx') THEN
    RAISE EXCEPTION 'Supplier invoice matching must support multiple purchase orders';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='tax_treatment')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='supplier_invoices' AND column_name='tax_document_reference') THEN
    RAISE EXCEPTION 'Supplier invoice tax evidence fields are missing';
  END IF;
  SELECT pg_get_functiondef('public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text)'::regprocedure) INTO v_def;
  IF position('tax_total' in v_def)=0 OR position('TAX:SUPPLIER_INPUT' in v_def)=0 OR position('4456' in v_def)=0 THEN
    RAISE EXCEPTION 'Supplier invoice VAT split and recoverability posting are incomplete';
  END IF;
  IF has_function_privilege('anon','public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.record_supplier_invoice_with_tax(uuid,uuid,text,date,date,numeric,numeric,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Supplier invoice tax RPC grants are incorrect';
  END IF;
  SELECT pg_get_functiondef('public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text)'::regprocedure) INTO v_def;
  IF position('purchase_order_id' in v_def)=0 OR position('quantity_invoiced' in v_def)=0
     OR position('v_invoice.subtotal' in v_def)=0 OR position('FOR UPDATE' in v_def)=0
     OR position('customer_mandate' in v_def)=0 THEN
    RAISE EXCEPTION 'Multi-order supplier invoice matching controls are incomplete';
  END IF;
  IF has_function_privilege('anon','public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.reconcile_supplier_invoice_multi_order(uuid,uuid,jsonb,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Multi-order supplier invoice matching RPC grants are incorrect';
  END IF;
  SELECT pg_get_functiondef('public.record_customer_mandate_disbursement(uuid,uuid,text,date,numeric,uuid,date,uuid)'::regprocedure) INTO v_def;
  IF position('exact_cost_supported' in v_def)=0 OR position('467' in v_def)=0
     OR position('financial_transactions' in v_def)=0 OR position('FOR UPDATE' in v_def)=0 THEN
    RAISE EXCEPTION 'Customer mandate supplier disbursement accounting is incomplete';
  END IF;
  SELECT pg_get_functiondef('public.record_customer_mandate_reimbursement(uuid,uuid,uuid,numeric,date,text,uuid)'::regprocedure) INTO v_def;
  IF position('customer_mandate_reimbursements' in v_def)=0 OR position('467' in v_def)=0
     OR position('financial_transactions' in v_def)=0 OR position('v_disbursement.amount-v_reimbursed' in v_def)=0 THEN
    RAISE EXCEPTION 'Customer mandate reimbursement accounting is incomplete';
  END IF;
END
$supplier_tax_multi_mandate$;

ROLLBACK;
