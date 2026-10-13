create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  email text not null,
  status text not null default 'active' check (status in ('active','revoked','error')),
  scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, provider)
);

alter table public.email_connections enable row level security;

drop policy if exists email_connections_select_own on public.email_connections;
create policy email_connections_select_own
on public.email_connections
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_org_member(organization_id)
);

create index if not exists email_connections_org_user_idx
  on public.email_connections (organization_id, user_id);

create table if not exists public.email_connection_secrets (
  connection_id uuid primary key references public.email_connections(id) on delete cascade,
  refresh_token_ciphertext text not null,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.email_connection_secrets enable row level security;
revoke all on table public.email_connection_secrets from anon, authenticated;
