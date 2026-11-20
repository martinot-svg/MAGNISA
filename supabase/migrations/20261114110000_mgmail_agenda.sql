-- Agenda magnibox : événements privés, de service et d'entreprise.
-- Aucune programmation de courrier externe n'est activée par cette migration.
create table if not exists public.magnibox_agenda_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  scope text not null check (scope in ('personal','service','company')),
  department text,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text not null default '' check (char_length(description) <= 5000),
  start_day date not null,
  start_time time without time zone not null,
  end_day date not null,
  end_time time without time zone not null,
  time_zone text not null default 'Indian/Antananarivo'
    check (char_length(time_zone) between 3 and 64),
  reminder_days integer[] not null default array[]::integer[],
  status text not null default 'scheduled'
    check (status in ('scheduled','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_agenda_department_scope check (
    (scope='service' and department is not null and char_length(btrim(department)) between 2 and 100)
    or (scope in ('personal','company') and department is null)
  ),
  constraint magnibox_agenda_date_range check (
    end_day > start_day or (end_day=start_day and end_time>start_time)
  ),
  constraint magnibox_agenda_reminders_count check (cardinality(reminder_days) <= 20)
);
-- Empêcher les délais non valides même lors d'un accès API direct.
create or replace function public.magnibox_valid_agenda_reminders(p_days integer[])
returns boolean language sql immutable strict
set search_path=pg_catalog,public
as $valid$
  select cardinality(p_days) <= 20
    and not exists(select 1 from unnest(p_days) as v where v < 0 or v > 365)
    and cardinality(p_days) = (select count(distinct v) from unnest(p_days) as v);
$valid$;
revoke all on function public.magnibox_valid_agenda_reminders(integer[]) from public,anon;
grant execute on function public.magnibox_valid_agenda_reminders(integer[]) to authenticated;
alter table public.magnibox_agenda_events
  add constraint magnibox_agenda_reminders_valid
  check (public.magnibox_valid_agenda_reminders(reminder_days));

create index if not exists magnibox_agenda_org_dates_idx
  on public.magnibox_agenda_events(organization_id,start_day,end_day)
  where status <> 'cancelled';
create index if not exists magnibox_agenda_owner_idx
  on public.magnibox_agenda_events(organization_id,created_by,start_day);

alter table public.magnibox_agenda_events enable row level security;

-- Les événements personnels sont réellement privés, y compris vis-à-vis
-- de l'administrateur. Les événements de service ne sont visibles que par
-- les membres du même département ou les responsables autorisés.
create policy magnibox_agenda_read
on public.magnibox_agenda_events for select to authenticated
using (
  public.is_org_member(organization_id)
  and (
    (scope='personal' and created_by=(select auth.uid()))
    or (scope='company')
    or (
      scope='service'
      and (
        public.has_org_permission(organization_id,'users.manage')
        or exists (
          select 1 from public.organization_members m
          where m.organization_id=magnibox_agenda_events.organization_id
            and m.user_id=(select auth.uid())
            and m.status='active' and m.department=magnibox_agenda_events.department
        )
      )
    )
  )
);

create policy magnibox_agenda_create
on public.magnibox_agenda_events for insert to authenticated
with check (
  public.is_org_member(organization_id)
  and created_by=(select auth.uid())
  and (
    (scope='personal' and department is null)
    or (
      scope='service' and department is not null
      and (
        public.has_org_permission(organization_id,'users.manage')
        or exists (
          select 1 from public.organization_members m
          where m.organization_id=magnibox_agenda_events.organization_id
            and m.user_id=(select auth.uid())
            and m.status='active' and m.department=magnibox_agenda_events.department
        )
      )
    )
    or (
      scope='company'
      and public.has_org_role(organization_id,array['owner','admin','director'])
    )
  )
);

create policy magnibox_agenda_edit
on public.magnibox_agenda_events for update to authenticated
using (
  public.is_org_member(organization_id)
  and (
    created_by=(select auth.uid())
    or (
      scope <> 'personal'
      and public.has_org_role(organization_id,array['owner','admin','director'])
    )
  )
)
with check (
  public.is_org_member(organization_id)
  and (
    created_by=(select auth.uid())
    or (
      scope <> 'personal'
      and public.has_org_role(organization_id,array['owner','admin','director'])
    )
  )
);

revoke all on table public.magnibox_agenda_events from anon,authenticated;
grant select,insert (
  organization_id,created_by,scope,department,title,description,
  start_day,start_time,end_day,end_time,time_zone,reminder_days
) on public.magnibox_agenda_events to authenticated;
grant update (
  title,description,start_day,start_time,end_day,end_time,
  time_zone,reminder_days,status,updated_at
) on public.magnibox_agenda_events to authenticated;
