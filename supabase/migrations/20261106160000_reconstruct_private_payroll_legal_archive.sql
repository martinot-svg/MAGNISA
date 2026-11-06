-- Reconstruct the private legal-source archive from the production catalog.
-- The original historical migration is absent from Git. This is an additive,
-- idempotent schema-parity migration; it preserves existing rows if the table exists.

begin;

create table if not exists public.payroll_legal_documents (
  id uuid not null default gen_random_uuid(),
  title text not null,
  category text not null,
  official_source_url text not null,
  issuing_authority text,
  document_reference text,
  published_on date,
  effective_from date,
  effective_to date,
  storage_path text,
  sha256 text,
  verification_status text not null default 'to_verify',
  notes text,
  created_at timestamptz not null default now(),
  constraint payroll_legal_documents_pkey primary key (id),
  constraint payroll_legal_documents_category_check
    check (category = any (array['IRSA','CNAPS','FMFP','SANTE','COMPTABILITE','AUTRE']::text[])),
  constraint payroll_legal_documents_dates
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint payroll_legal_documents_storage_path_key unique (storage_path),
  constraint payroll_legal_documents_verification_status_check
    check (verification_status = any (array['to_verify','verified','superseded']::text[]))
);

alter table public.payroll_legal_documents enable row level security;
revoke all privileges on table public.payroll_legal_documents from public, anon, authenticated;
grant all privileges on table public.payroll_legal_documents to service_role;

commit;
