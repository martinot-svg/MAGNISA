-- Supabase security and performance audit follow-up.
-- Restrict anonymous execution of privileged functions, lock down trigger helpers,
-- expose the read-only legal reference catalogue only to signed-in users, and index
-- public-schema foreign-key columns that currently lack a suitable leading index.

begin;

-- Trigger functions are invoked by their table triggers, not as client RPC endpoints.
revoke all on function public.audit_payroll_rule_change() from public, anon, authenticated;
revoke all on function public.capture_document_appearance() from public, anon, authenticated;
revoke all on function public.capture_document_template_version() from public, anon, authenticated;
revoke all on function public.payroll_compute_fmfp_on_insert() from public, anon, authenticated;
revoke all on function public.payroll_fmfp_debit_line() from public, anon, authenticated;
revoke all on function public.store_document_template_version() from public, anon, authenticated;

-- These RPCs remain available to authenticated users where currently granted.
-- Anonymous calls are not required and must not be able to invoke privileged operations.
revoke execute on function public.activate_payroll_rule(uuid, uuid) from anon;
revoke execute on function public.can_view_document_template_version(uuid, uuid) from anon;
revoke execute on function public.lot2_record_payroll_payment_idempotent(uuid, uuid, uuid, numeric, text, date, text, uuid) from anon;
revoke execute on function public.lot2_record_suppl¶»§q«^