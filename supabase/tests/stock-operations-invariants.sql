-- Structural and privilege assertions for the operational stock subledger.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE t text; v_def text;
BEGIN
 FOREACH t IN ARRAY ARRAY['stock_reservations','stock_reservation_events','sales_deliveries','sales_delivery_lines','stock_transfers','stock_transfer_lines','accounting_event_outbox','stock_returns','stock_return_lines','stock_adjustments','stock_adjustment_lines'] LOOP
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
 IF NOT has_function_privilege('authenticated','public.post_customer_stock_return(uuid,uuid,uuid,numeric,text,uuid,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.post_supplier_stock_return(uuid,uuid,uuid,numeric,uuid,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.post_stock_adjustment(uuid,uuid,uuid,text,numeric,numeric,text,text,uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.cancel_stock_transfer(uuid,uuid,uuid,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.cancel_sales_delivery(uuid,uuid,uuid,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.stock_balance_as_of(uuid,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'Returns, adjustments, cancellation or as-of RPC grants are missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.stock_movements'::regclass AND conname='stock_movements_stock_bucket_check'
  AND position('quarantine' in pg_get_constraintdef(oid))>0) THEN
  RAISE EXCEPTION 'Quarantine stock bucket is not supported by the movement ledger';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='stock_return' AND operation_key='merchandise_stock' AND debit_account_code='37' AND active)
    OR NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='stock_supplier_return' AND operation_key='stock_variation' AND debit_account_code='603' AND active)
    OR NOT EXISTS(SELECT 1 FROM public.accounting_posting_rules WHERE operation_type='stock_adjustment_in' AND operation_key='merchandise_stock' AND debit_account_code='37' AND active) THEN
  RAISE EXCEPTION 'Return and inventory adjustment accounting rules are missing';
 END IF;
 SELECT pg_get_functiondef('private.assign_stock_movement_bucket()'::regprocedure) INTO v_def;
 IF position('stock_return_lines' in v_def)=0 OR position('stock_adjustment_lines' in v_def)=0 OR position('stock_transfer_cancel' in v_def)=0 THEN
  RAISE EXCEPTION 'Compensating movement bucket provenance is incomplete';
 END IF;
 SELECT pg_get_functiondef('private.post_stock_movement_accounting()'::regprocedure) INTO v_def;
 IF position('stock_supplier_return' in v_def)=0 OR position('stock_adjustment_in' in v_def)=0 OR position('delivery_cancel' in v_def)=0 THEN
  RAISE EXCEPTION 'Return and adjustment events are not connected to the accounting outbox';
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
 SELECT pg_get_functiondef('public.create_invoice_draft(uuid,uuid,date,jsonb,uuid)'::regprocedure) INTO v_def;
 IF position('delivered_quantity' in v_def)=0 OR position('source_order_line_id' in v_def)=0 OR position('line_kind' in v_def)=0 THEN
  RAISE EXCEPTION 'Mixed invoice draft does not enforce delivered source quantities';
 END IF;
 SELECT pg_get_functiondef('public.issue_invoice(uuid,uuid)'::regprocedure) INTO v_def;
 IF position('magnisa_post_journal' in v_def)=0 OR position('merchandise_revenue' in v_def)=0 OR position('service_revenue' in v_def)=0 THEN
  RAISE EXCEPTION 'Invoice issuance is not mapped by line nature through the versioned journal engine';
 END IF;
 IF has_function_privilege('anon','public.release_stock_reservation(uuid,uuid,numeric,uuid)','EXECUTE') OR has_function_privilege('anon','public.post_sales_delivery(uuid,uuid,jsonb,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous execution of stock operation RPCs is exposed';
 END IF;
 IF to_regclass('public.stock_quarantine_releases') IS NULL
    OR to_regclass('public.stock_quarantine_release_lines') IS NULL THEN
  RAISE EXCEPTION 'Quarantine inspection and release ledger tables are missing';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_quarantine_releases'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.stock_quarantine_release_lines'::regclass)
    OR has_table_privilege('anon','public.stock_quarantine_releases','SELECT')
    OR has_table_privilege('anon','public.stock_quarantine_release_lines','SELECT') THEN
  RAISE EXCEPTION 'Quarantine release RLS or anonymous access controls are incorrect';
 END IF;
 IF NOT has_function_privilege('authenticated',
    'public.release_stock_from_quarantine(uuid,uuid,uuid,uuid,numeric,text,uuid,text)','EXECUTE')
    OR has_function_privilege('anon',
    'public.release_stock_from_quarantine(uuid,uuid,uuid,uuid,numeric,text,uuid,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Quarantine release RPC grants are incorrect';
 END IF;
 SELECT pg_get_functiondef('public.release_stock_from_quarantine(uuid,uuid,uuid,uuid,numeric,text,uuid,text)'::regprocedure)
 INTO v_def;
 IF position('pg_advisory_xact_lock' in v_def)=0
    OR position('stock_bucket=''quarantine''' in v_def)=0
    OR position('quarantine_reclassification' in v_def)=0
    OR position('destination_bucket' in v_def)=0
    OR position('request_key' in v_def)=0 THEN
  RAISE EXCEPTION 'Quarantine release lacks locking, provenance, reclassification or idempotency controls';
 END IF;
END $;
ROLLBACK;
