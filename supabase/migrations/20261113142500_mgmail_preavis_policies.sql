-- MGMail : politiques de préavis de facturation, globales ou propres à un contrat.
-- Les e-mails ne sont pas envoyés par cette migration.
create table if not exists public.mgmail_preavis_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recurring_contract_id uuid references public.recurring_service_contracts(id) on delete cascade,
  enabled boolean not null default true,
  rules jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rules) = 'array'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Une seule politique par organisation, et une seule exception par contrat.
create unique index if not exists mgmail_preavis_org_default_uidx
  on public.mgmail_preavis_policies (organization_id)
  where recurring_contract_id is null;

create unique index if not exists mgmail_preavis_org_contract_uidx
  on public.mgmail_preavis_policies (organization_id, recurring_contract_id)
  where recurring_contract_id is not null;

create index if not exists mgmail_preavis_org_idx
  on public.mgmail_preavis_policies (organization_id);

alter table public.mgmail_preavis_policies enable row level security;

drop policy if exists mgmail_preavis_policies_read on public.mgmail_preavis_policies;
create policy mgmail_preavis_policies_read
  on public.mgmail_preavis_policies for select to authenticated
  using (
    public.has_org_permission(organization_id, 'sales.view')
    and (
      recurring_contract_id is null or exists (
        select 1 from public.recurring_service_contracts c
        where c.id = recurring_contract_id and c.organization_id = organization_id
      )
    )
  );

drop policy if exists mgmail_preavis_policies_insert on public.mgmail_preavis_policies;
create policy mgmail_preavis_policies_insert
  on public.mgmail_preavis_policies for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'orders.manage')
    and (
      recurring_contract_id is null or exists (
        select 1 from public.recurring_service_contracts c
        where c.id = recurring_contract_id and c.organization_id = organization_id
      )
    )
  );

drop policy if exists mgmail_preavis_policies_update on public.mgmail_preavis_policies;
create policy mgmail_preavis_policies_update
  on public.mgmail_preavis_policies for update to authenticated
  using (public.has_org_permission(organization_id, 'orders.manage'))
  with check (
    public.has_org_permission(organization_id, 'orders.manage')
    and (
      recurring_contract_id is null or exists (
        select 1 from public.recurring_service_contracts c
        where c.id = recurring_contract_id and c.organization_id = organization_id
      )
    )
  );

-- Tout accès non couvert par ces politiques est refusé.
revoke all on table public.mgmail_preavis_policies from anon, authenticated;
grant select, insert, update on table public.mgmail_preavis_policies to authenticated;
