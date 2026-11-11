create table if not exists public.payroll_legal_documents (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 category text not null check(category in ('IRSA','CNAPS','FMFP','SANTE','COMPTABILITE','AUTRE')),
 official_source_url text not null,
 issuing_authority text,
 document_reference text,
 published_on date,
 effective_from date,
 effective_to date,
 storage_path text unique,
 sha256 text,
 verification_status text not null default 'to_verify' check(verification_status in ('to_verify','verified','superseded')),
 notes text,
 created_at timestamptz not null default now(),
 constraint payroll_legal_documents_dates check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
alter table public.payroll_legal_documents enable row level security;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('payroll-legal-archive','payroll-legal-archive',false,20971520,array['application/pdf'])
on conflict(id) do nothing;