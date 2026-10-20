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
revoke execute on function public.lot2_record_supplier_payment_idempotent(uuid, uuid, uuid, numeric, text, date, text, uuid) from anon;
revoke execute on function public.magnisa_confirm_transfer_credit(uuid, uuid, date, text) from anon;
revoke execute on function public.magnisa_record_transfer_debit(uuid, uuid, uuid, date, numeric, numeric, numeric, text, uuid) from anon;

-- This table is a shared legal-reference catalogue, not tenant data.
-- Authenticated users may read catalogue entries; anonymous users and clients
-- may not write or administer it. Writes remain available to trusted server roles.
revoke all on table public.payroll_legal_documents from anon, authenticated;
grant select on table public.payroll_legal_documents to authenticated;
drop policy if exists payroll_legal_documents_authenticated_read on public.payroll_legal_documents;
create policy payroll_legal_documents_authenticated_read
  on public.payroll_legal_documents
  for select
  to authenticated
  using (true);

-- Index each public foreign-key column that lacks a suitable index.
create index if not exists idx_document_template_versions_organization_id
  on public.document_template_versions (organization_id);
create index if not exists idx_document_templates_owner_user_id
  on public.document_templates (owner_user_id);
create index if not exists idx_email_history_connection_id
  on public.email_history (connection_id);
create index if not exists idx_email_history_created_by
  on public.email_history (created_by);
create index if not exists idx_email_history_credit_note_id
  on public.email_history (credit_note_id);
create index if not exists idx_email_history_invoice_id
  on public.email_history (invoice_id);
create index if not exists idx_email_history_payment_id
  on public.email_history (payment_id);
create index if not exists idx_email_history_project_id
  on public.email_history (project_id);
create index if not exists idx_email_history_quote_id
  on public.email_history (quote_id);
create index if not exists idx_email_templates_created_by
  on public.email_templates (created_by);
create index if not exists idx_magnisa_internal_transfers_destination_account_id
  on public.magnisa_internal_transfers (destination_account_id);
create index if not exists idx_pcg2005_account_mappings_pcg_code
  on public.pcg2005_account_mappings (pcg_code);
create index if not exists idx_pcg2005_account_mappings_updated_by
  on public.pcg2005_account_mappings (updated_by);
create index if not exists idx_user_document_permissions_granted_by
  on public.user_document_permissions (granted_by);

commit;
