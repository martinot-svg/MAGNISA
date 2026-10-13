alter table public.email_connections
  drop constraint if exists email_connections_provider_check;
alter table public.email_connections
  add constraint email_connections_provider_check
  check (provider in ('google','microsoft'));

create table if not exists public.email_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.email_connections(id) on delete set null,
  provider text not null default 'google',
  provider_message_id text not null,
  provider_thread_id text,
  direction text not null check (direction in ('incoming','outgoing','draft')),
  from_email text,
  to_emails text[] not null default '{}'::text[],
  cc_emails text[] not null default '{}'::text[],
  subject text,
  snippet text,
  occurred_at timestamptz,
  customer_id uuid references public.customers(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  credit_note_id uuid references public.credit_notes(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  attachment_names text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, provider_message_id)
);

create index if not exists email_history_org_customer_idx
  on public.email_history (organization_id, customer_id, occurred_at desc);
create index if not exists email_history_org_thread_idx
  on public.email_history (organization_id, provider_thread_id);

alter table public.email_history enable row level security;

drop policy if exists email_history_select_org on public.email_history;
create policy email_history_select_org
on public.email_history
for select
to authenticated
using (public.is_org_member(organization_id));

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_key text not null,
  name text not null,
  subject_template text not null default '',
  body_template text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, template_key)
);

alter table public.email_templates enable row level security;

drop policy if exists email_templates_select_org on public.email_templates;
create policy email_templates_select_org
on public.email_templates
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists email_templates_manage_admin on public.email_templates;
create policy email_templates_manage_admin
on public.email_templates
for all
to authenticated
using (public.has_org_role(organization_id, array['owner','admin']::text[]))
with check (public.has_org_role(organization_id, array['owner','admin']::text[]));
