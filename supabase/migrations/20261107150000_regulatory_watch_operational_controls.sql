begin;

create table if not exists public.regulatory_watch_source_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null check (source_key in ('dgi-legislation','cnlegis','cnaps-sme','fmfp-legal')),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_http_status integer,
  last_error text,
  primary key (organization_id, source_key)
);

create table if not exists public.regulatory_watch_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  sources_checked integer not null default 0 check (sources_checked >= 0),
  changes_detected integer not null default 0 check (changes_detected >= 0),
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.regulatory_source_snapshots
  add column if not exists content_excerpt text,
  add column if not exists last_http_status integer;

alter table public.regulatory_watch_events
  drop constraint if exists regulatory_watch_events_review_status_check;
alter table public.regulatory_watch_events
  add constraint regulatory_watch_events_review_status_check
  check (review_status in ('unreviewed','reviewed','validated','not_relevant'));

alter table public.regulatory_watch_events
  add column if not exists previous_excerpt text,
  add column if not exists current_excerpt text,
  add column if not exists source_final_url text,
  add column if not exists http_status integer,
  add column if not exists review_note text;

create index if not exists regulatory_watch_runs_org_started_idx
  on public.regulatory_watch_runs (organization_id, started_at desc);
create index if not exists regulatory_watch_source_settings_enabled_idx
  on public.regulatory_watch_source_settings (organization_id, enabled);

alter table public.regulatory_watch_source_settings enable row level security;
alter table public.regulatory_watch_runs enable row level security;

drop policy if exists regulatory_watch_source_settings_member_read on public.regulatory_watch_source_settings;
create policy regulatory_watch_source_settings_member_read
  on public.regulatory_watch_source_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists regulatory_watch_source_settings_admin_insert on public.regulatory_watch_source_settings;
create policy regulatory_watch_source_settings_admin_insert
  on public.regulatory_watch_source_settings for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner','admin','director']));
drop policy if exists regulatory_watch_source_settings_admin_update on public.regulatory_watch_source_settings;
create policy regulatory_watch_source_settings_admin_update
  on public.regulatory_watch_source_settings for update to authenticated
  using (public.has_org_role(organization_id, array['owner','admin','director']))
  with check (public.has_org_role(organization_id, array['owner','admin','director']));

drop policy if exists regulatory_watch_runs_member_read on public.regulatory_watch_runs;
create policy regulatory_watch_runs_member_read
  on public.regulatory_watch_runs for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.regulatory_watch_source_settings from public, anon;
revoke all on public.regulatory_watch_runs from public, anon, authenticated;
grant select, insert, update on public.regulatory_watch_source_settings to authenticated;
grant select on public.regulatory_watch_runs to authenticated;
grant all on public.regulatory_watch_source_settings to service_role;
grant all on public.regulatory_watch_runs to service_role;
grant all on public.regulatory_source_snapshots to service_role;
grant all on public.regulatory_watch_events to service_role;

insert into public.regulatory_watch_source_settings (organization_id, source_key)
select o.id, s.source_key
from public.organizations o
cross join (values
  ('dgi-legislation'),
  ('cnlegis'),
  ('cnaps-sme'),
  ('fmfp-legal')
) as s(source_key)
on conflict (organization_id, source_key) do nothing;

commit;
