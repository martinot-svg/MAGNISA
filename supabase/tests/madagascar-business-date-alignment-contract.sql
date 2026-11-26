-- Contract: Malagasy business dates, J-5 recurring preparation and analytics completeness.
DO $contract$
DECLARE
  v_definition text;
  v_jobs integer;
BEGIN
  IF to_regprocedure('public.magnisa_business_date()') IS NULL THEN
    RAISE EXCEPTION 'Madagascar business-date helper is missing';
  END IF;
  IF public.magnisa_business_date() IS DISTINCT FROM (now() AT TIME ZONE 'Indian/Antananarivo')::date THEN
    RAISE EXCEPTION 'Business date does not match Indian/Antananarivo';
  END IF;
  IF has_function_privilege('anon','public.magnisa_business_date()','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute the business-date helper';
  END IF;
  IF NOT has_function_privilege('authenticated','public.magnisa_business_date()','EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role cannot execute the business-date helper';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f'
      AND (
        (n.nspname='public' AND p.proname = ANY(ARRAY[
          'analysis_metrics','archive_payroll_rule','calculate_prospect_commission','cancel_invoice',
          'close_loan_early','convert_order_to_invoice','convert_quote_to_invoice','convert_quote_to_order',
          'create_direct_invoice_from_service','create_invoice_draft','create_invoice_draft_from_order',
          'create_quote_draft','create_quote_from_service','dashboard_metrics','duplicate_quote',
          'issue_customer_credit_note','magnisa_close_fiscal_year','magnisa_confirm_transfer_credit',
          'magnisa_record_transfer_debit','magnisa_resolve_pcg_account','record_invoice_payment',
          'record_loan_repayment','reverse_loan_repayment','run_loan_deadline_notifications',
          'set_recurring_service_status','validate_payslip'
        ]))
        OR (n.nspname='private' AND p.proname='generate_all_due_recurring_invoice_drafts')
      )
      AND pg_get_functiondef(p.oid) ILIKE '%current_date%'
  ) THEN
    RAISE EXCEPTION 'A business workflow still depends on PostgreSQL session current_date instead of the Madagascar business date';
  END IF;

  v_definition := pg_get_functiondef('private.generate_all_due_recurring_invoice_drafts()'::regprocedure);
  IF v_definition ILIKE '%next_billing_date <=%' THEN
    RAISE EXCEPTION 'Global recurring scheduler still filters out future J-5 contracts';
  END IF;
  IF v_definition NOT ILIKE '%private.process_due_recurring_invoice_drafts%' THEN
    RAISE EXCEPTION 'Global recurring scheduler no longer delegates to the horizon-aware processor';
  END IF;

  v_definition := pg_get_functiondef('private.process_due_recurring_invoice_drafts(uuid,uuid)'::regprocedure);
  IF v_definition NOT ILIKE '%v_horizon%' OR v_definition NOT ILIKE '%v_lead_days%'
     OR v_definition NOT ILIKE '%Indian/Antananarivo%' THEN
    RAISE EXCEPTION 'Recurring invoice processor lost its local-date lead horizon';
  END IF;

  v_definition := pg_get_functiondef('public.set_recurring_service_status(uuid,uuid,text,text)'::regprocedure);
  IF v_definition NOT ILIKE '%v_next_billing_date < public.magnisa_business_date()%'
     OR v_definition ILIKE '%v_next_billing_date <=%' THEN
    RAISE EXCEPTION 'Resuming a contract must preserve a billing cycle due today and skip only missed cycles';
  END IF;

  v_definition := pg_get_functiondef('public.analysis_metrics(uuid)'::regprocedure);
  IF v_definition ILIKE '%current_date%'
     OR v_definition NOT ILIKE '%source_order_line_id%'
     OR v_definition NOT ILIKE '%unbilled_completed_services%' THEN
    RAISE EXCEPTION 'Analytics must use local dates and calculate completed services awaiting invoicing';
  END IF;

  v_definition := pg_get_functiondef('public.dashboard_metrics(uuid)'::regprocedure);
  IF v_definition ILIKE '%current_date%' OR v_definition NOT ILIKE '%magnisa_business_date%' THEN
    RAISE EXCEPTION 'Dashboard overdue metrics must use the local business date';
  END IF;

  v_definition := pg_get_functiondef('public.create_invoice_draft(uuid,uuid,date,jsonb,uuid)'::regprocedure);
  IF v_definition ILIKE '%current_date%' OR v_definition NOT ILIKE '%magnisa_business_date%' THEN
    RAISE EXCEPTION 'Invoice draft dates must use the local business date';
  END IF;

  v_definition := pg_get_functiondef('public.create_quote_draft(uuid,uuid,date,jsonb)'::regprocedure);
  IF v_definition ILIKE '%current_date%' OR v_definition NOT ILIKE '%magnisa_business_date%' THEN
    RAISE EXCEPTION 'Quote validity must use the local business date';
  END IF;

  v_definition := pg_get_functiondef('public.run_loan_deadline_notifications(date)'::regprocedure);
  IF v_definition NOT ILIKE '%DEFAULT public.magnisa_business_date()%' THEN
    RAISE EXCEPTION 'Loan notification default date must use the local business date';
  END IF;

  SELECT count(*) INTO v_jobs
  FROM cron.job
  WHERE jobname='magnisa-recurring-invoice-drafts'
    AND schedule='0 * * * *'
    AND active;
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active hourly recurring invoice scheduler';
  END IF;
END;
$contract$;
