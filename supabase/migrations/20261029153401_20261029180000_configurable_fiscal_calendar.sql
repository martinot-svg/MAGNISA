-- Separate organization-scoped rules for fiscal declaration calendars.
-- No legal dates or tax regimes are seeded; each rule requires official verification.
create table if not exists public.fiscal_calendar_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  organism_code text not null check (organism_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  label text not null check (length(trim(label)) between 2 and 160),
  periodicity text not null check (periodicity in ('monthly','quarterly','annual','one_off')),
  due_rule jsonb not null default '{}'::jsonb check (jsonb_typeof(due_rule) = 'object'),
  effective_from date not null,
  effective_to date,
  source_label text,
  source_url text,
  status text not null default 'draft' check (status in ('draft','validated','archived')),
  notes text,
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (
    status <> 'validated'
    or (
      length(trim(coalesce(source_label,''))) > 0
      and effective_from is not null
      and (source_url is null or source_url ~ '^https?://')
      and due_rule <> '{}'::jsonb
    )
  )
);

create index if not exists fiscal_calendar_rules_org_lookup_idx
  on public.fiscal_calendar_rules(organization_id, organism_code, status, effective_from desc);

create unique index if not exists fiscal_calendar_rules_one_validated_start_idx
  on public.fiscal_calendar_rules(organization_id, organism_code, effective_from)
  where status = 'validated';

alter table public.fiscal_calendar_rules enable row level security;

drop policy if exists fiscal_calendar_rules_read on public.fiscal_calendar_rules;
create policy fiscal_calendar_rules_read on public.fiscal_calendar_rules
  for select to authenticated
  using (public.has_org_permission(organization_id, 'finance.view'));

drop policy if exists fiscal_calendar_rules_insert on public.fiscal_calendar_rules;
create policy fiscal_calendar_rules_insert on public.fiscal_calendar_rules
  for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'accounting.manage')
    and (status = 'draft' or status = 'archived')
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists fiscal_calendar_rules_update on public.fiscal_calendar_rules;
create policy fiscal_calendar_rules_update on public.fiscal_calendar_rules
  for update to authenticated
  using (public.has_org_permission(organization_id, 'accounting.manage'))
  with check (
    public.has_org_permission(organization_id, 'accounting.manage')
    and (updated_by is null or updated_by = auth.uid())
  );

drop policy if exists fiscal_calendar_rules_delete on public.fiscal_calendar_rules;
create policy fiscal_calendar_rules_delete on public.fiscal_calendar_rules
  for delete to authenticated
  using (
    public.has_org_permission(organization_id, 'accounting.manage')
    and status = 'draft'
  );

create or replace function public.set_fiscal_calendar_rule_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists fiscal_calendar_rules_updated_at on public.fiscal_calendar_rules;
create trigger fiscal_calendar_rules_updated_at
  before update on public.fiscal_calendar_rules
  for each row execute function public.set_fiscal_calendar_rule_updated_at();

comment on table public.fiscal_calendar_rules is
  'Versioned organization-specific fiscal declaration calendar rules. Rules must be verified against an official source before validation.';
comment on column public.fiscal_calendar_rules.due_rule is
  'JSON rule schema compatible with configurable-calendar due date helpers. No assumed legal deadlines are seeded.';
