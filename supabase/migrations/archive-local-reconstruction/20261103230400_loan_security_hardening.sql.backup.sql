-- Internal trigger functions must not be callable as RPCs.
REVOKE ALL ON FUNCTION public.store_document_template_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_fmfp_debit_line() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payroll_compute_fmfp_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_payroll_rule_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_document_appearance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_document_template_version() FROM PUBLIC, anon, authenticated;

-- This table has RLS enabled but intentionally has no client-facing policies.
REVOKE ALL ON TABLE public.fiscal_rules FROM PUBLIC, anon, authenticated;

-- Harden the search path of privileged loan RPCs.
ALTER FUNCTION public.record_loan_repayment(uuid,uuid,uuid,date,numeric,uuid,uuid,text,text)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.create_loan_schedule_amendment(uuid,uuid,date,text,text,jsonb)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.reverse_loan_repayment(uuid,uuid,date,uuid,text)
  SET search_path = pg_catalog, public, pg_temp;
