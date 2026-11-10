-- Structural and privilege assertions for the operational stock subledger.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE t text; v_def text;
BEGIN
 FOREACH t IN ARRAY ARRAY['stock_reservations','stock_reservation_events','sales_deliveries','sales_delivery_lines','stock_transfers','stock_transfer_lines','accounting_event_outbox'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Missing stock workflow table: %',t; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN RAISE EXCEPTION 'RLS disabled on %',t; END IF;
  IF has_table_privilege('anon','public.'||t,'SELECT') OR has_table_privilege('anon','public.'||t,'INSERT') OR has_table_privilege('anon','public.'||t,'UPDATE') OR has_table_privilege('anon','public.'||t,'DELETE') THEN
   RAISE EXCEPTION 'Anonymous access exposed on %',t;
  END IF;
 END LOOP;
 IF to_regclass('public.stock_available') IS NULL OR to_regclass('public.stock_on_hand_by_bucket') IS NULL THEN RAISE EXCEPTION 'Stock availability views missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_movements' AND column_name='stock_bucket') THEN
  RAISE EXCEPTION 'Stock purpose bucket is missing from persistent movements';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='stock_movements_assign_bucket' AND NOT tgisinternal)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='stock_movements_accounting_post' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Stock bucket classification or accounting outbox trigger is missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pcg2005_accounts WHERE code='603')
    OR NOT EXISTS(SELECT 1 FROM public.pcg2005_accounts WHERE code='707') THEN
  RAISE EXCEPTION 'PCG 2005 stock variation or merchandise revenue account is missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='stock_issue' AND operation_key='stock_variation' AND debit_account_code='603' AND active)
    OR NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='invoice' AND operation_key='merchandise_revenue' AND credit_account_code='707' AND active)
    OR NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='invoice' AND operation_key='service_revenue' AND credit_account_code='706' AND active) THEN
  RAISE EXCEPTION 'Versioned stock and mixed invoice posting rules are missing';
 END IF;
 IF NOT has_function_privilege('authenticated','public.process_stock_accounting_event(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.process_stock_accounting_event(uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Stock accounting outbox processing grants are incorrect';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_lines' AND column_name='item_id') THEN
  RAISE EXCEPTION 'Order item linkage missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='stock_reservations_available_idx') THEN
  RAISE EXCEPTION 'Reservation availability index missing';
 END IF;
 SELECT pg_get_functiondef('public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid)'::regprocedure) INTO v_def;
 IF position('private.reserve_stock' in v_def)=0 OR has_function_privilege('anon','public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Reservation RPC wrapper or grants are incorrect';
 END IF;
 SELECT pg_get_functiondef('private.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid)'::regprocedure) INTO v_def;
 IF position('pg_advisory_xact_lock' in v_def)=0 OR position('quantity_reserved' in v_def)=0 OR position('stock_bucket' in v_def)=0 THEN
  RAISE EXCEPTION 'Reservation concurrency/quantity guards missing';
 END IF;
 SELECT pg_get_functiondef('private.post_sales_delivery(uuid,uuid,jsonb,uuid,text)'::regprocedure) INTO v_def;
 IF position('sales-delivery:' in v_def)=0 OR position('quantity_delivered' in v_def)=0 OR position('quantity_fulfilled' in v_def)=0 OR position('stock_bucket' in v_def)=0 THEN
  RAISE EXCEPTION 'Delivery stock posting and reservation fulfilment missing';
 END IF;
 SELECT pg_get_functiondef('private.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text)'::regprocedure) INTO v_def;
 IF position('transfer_out' in v_def)=0 OR position('transfer_in' in v_def)=0 OR position('pg_advisory_xact_lock' in v_def)=0 OR position('stock_bucket' in v_def)=0 THEN
  RAISE EXCEPTION 'Transfer paired movements or concurrency guards missing';
 END IF;
 IF has_function_privilege('anon','public.release_stock_reservation(uuid,uuid,numeric,uuid)','EXECUTE') OR has_function_privilege('anon','public.post_sales_delivery(uuid,uuid,jsonb,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous execution of stock operation RPCs is exposed';
 END IF;
END $$;
ROLLBACK;
