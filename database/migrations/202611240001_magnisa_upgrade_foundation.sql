-- MAGNISA upgrade extension: foundation tables only.
-- Review organization membership predicate against the live schema before applying.
create extension if not exists btree_gist;

create table if not exists public.magnisa_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'MGA',
  pricing_unit text not null check (pricing_unit in ('fixed','hourly','daily','monthly','yearly','per_participant','per_session')),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists magnisa_price_history_lookup
  on public.magnisa_price_history (organization_id, service_id, effective_from desc);

create table if not exists public.magnisa_customer_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  title text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  assigned_to uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists magnisa_customer_reminders_due
  on public.magnisa_customer_reminders (organization_id, status, due_at);

create table if not exists public.magnisa_resource_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  resource_key text not null,
  customer_id uuid,
  order_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('held','confirmed','cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.magnisa_resource_reservations
  add constraint magnisa_resource_reservations_no_overlap
  exclude using gist (
    organization_id with =,
    resource_key with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held','confirmed'));

-- RLS is enabled. Policies intentionally use the project's organization membership table.
alter table public.magnisa_price_history enable row level security;
alter table public.magnisa_customer_reminders enable row level security;
alter table public.magnisa_resource_reservations enable row level security;

-- Adapt the membership predicate if the repository's organization_members schema differs.
drop policy if exists magnisa_price_history_org_access on public.magnisa_price_history;
create policy magnisa_price_history_org_access on public.magnisa_price_history
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_price_history.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_price_history.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ));

drop policy if exists magnisa_customer_reminders_org_access on public.magnisa_customer_reminders;
create policy magnisa_customer_reminders_org_access on public.magnisa_customer_reminders
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_customer_reminders.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_customer_reminders.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ));

drop policy if exists magnisa_resource_reservations_org_access on public.magnisa_resource_reservations;
create policy magnisa_resource_reservations_org_access on public.magnisa_resource_reservations
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_resource_reservations.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ))
  with check (exists (
    select 1 from public.organization_members m
    where m.organization_id = magnisa_resource_reservations.organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  ));
