-- Customer credit-note, returned-quantity and cash-refund invariants.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE v_def text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_note_lines','credit_note_refunds'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN
      RAISE EXCEPTION 'Missing customer credit-note workflow table: %',t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN
      RAISE EXCEPTION 'RLS is disabled on %',t;
    END IF;
    IF has_table_privilege('anon','public.'||t,'SELECT')
       OR has_table_privilege('anon','public.'||t,'INSERT')
       OR has_table_privilege('anon','public.'||t,'UPDATE')
       OR has_table_privilege('anon','public.'||t,'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access is exposed on %',t;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated',
      'public.issue_customer_credit_note(uuid,uuid,date,jsonb,text,uuid)','EXECUTE')
     OR has_function_privilege('anon',
      'public.issue_customer_credit_note(uuid,uuid,date,jsonb,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
      'public.record_customer_credit_note_refund(uuid,uuid,uuid,numeric,date,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon',
      'public.record_customer_credit_note_refund(uuid,uuid,uuid,numeric,date,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Customer credit-note RPC grants are incorrect';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.financial_transactions'::regclass
      AND conname='financial_transactions_kind_check'
      AND position('customer_refund' in pg_get_constraintdef(oid))>0) THEN
    RAISE EXCEPTION 'Customer refund transaction kind is not supported';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounting_posting_rules
      WHERE operation_type='customer_credit_note' AND operation_key='customer_receivable'
        AND credit_account_code='411' AND active)
     OR NOT EXISTS (SELECT 1 FROM public.accounting_posting_rules
      WHERE operation_type='customer_credit_note' AND operation_key='tax_payable'
        AND debit_account_code='4457' AND active) THEN
    RAISE EXCEPTION 'Customer credit-note PCG posting rules are missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_customer_credit_note(uuid,uuid,date,jsonb,text,uuid)'::regprocedure
  ) INTO v_def;
  IF position('FOR UPDATE' in v_def)=0
     OR position('stock_return_line_id' in v_def)=0
     OR position('source_invoice_line_id' in v_def)=0
     OR position('request_fingerprint' in v_def)=0
     OR position('magnisa_post_journal' in v_def)=0
     OR position('credited_amount' in v_def)=0 THEN
    RAISE EXCEPTION 'Credit note issue lacks source, quantity, idempotency, balance or journal controls';
  END IF;

  SELECT pg_get_functiondef(
    'public.record_customer_credit_note_refund(uuid,uuid,uuid,numeric,date,text,text,uuid)'::regprocedure
  ) INTO v_def;
  IF position('refundable_amount' in v_def)=0
     OR position('financial_accounts' in v_def)=0
     OR position('financial_transactions' in v_def)=0
     OR position('magnisa_post_journal' in v_def)=0
     OR position('request_key' in v_def)=0 THEN
    RAISE EXCEPTION 'Credit note refund lacks balance, treasury, transaction, journal or idempotency controls';
  END IF;
END $$;
ROLLBACK;
