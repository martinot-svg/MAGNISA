-- Agenda MGMail : événements privés, de service et d'entreprise.
-- Aucune programmation de courrier externe n'est activée par cette migration.
create table if not exists public.mgmail_agenda_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
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
  constraint mgmail_agenda_department_scope check (
    (scope='service' and department is not null and char_length(btrim(department)) between 2 and 100)
    or (scope in ('personal','company') and department is null)
  ),
  constraint mgmail_agenda_date_range check (
    end_day > start_day or (end_day=start_day and end_time>start_time)
  ),
  constraint mgmail_agenda_reminders_count check (cardinality(reminder_days) <= 20)
);
create index if not exists mgmail_agenda_org_dates_idx
  on public.mgmail_agenda_events(organization_id,start_day,end_day)
  where status <> 'cancelled';
create index if not exists mgmail_agenda_owner_idx
  on public.mgmail_agenda_events(organization_id,created_by,start_day);

alter table public.mgmail_agenda_events enable row level security;

-- Les événements personnels sont réellement privés, y compris vis-à-vis
-- de l'administrateur. Les événements de service ne sont visibles que par
-- les membres du même département ou les responsables autorisés.
create policy mgmail_agenda_read
on public.mgmail_agenda_events for select to authenticated
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
          where m.organization_id=mgmail_agenda_events.organization_id
            and m.user_id=(select auth.uid())
            and m.status='active' and m.department=mgmail_agenda_events.department
        )
      )
    )
  )
);

create policy mgmail_agenda_create
on public.mgmail_agenda_events for insert to authenticated
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
          where m.organization_id=mgmail_agenda_events.organization_id
            and m.user_id=(select auth.uid())
            and m.status='active' and m.department=mgmail_agenda_events.department
        )
      )
    )
    or (
      scope='company'
      and public.has_org_role(organization_id,array['owner','admin','director'])
    )
  )
);

create policy mgmail_agenda_edit
on public.mgmail_agenda_events for update to authenticated
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

revoke all on table public.mgmail_agenda_events from anon,authenticated;
grant select,insert (
  organization_id,created_by,scope,department,title,description,
  start_day,start_time,end_day,end_time,time_zone,reminder_days
) on public.mgmail_agenda_events to authenticated;
grant update (
  title,description,start_day,start_time,end_day,end_time,
  time_zone,reminder_days,status,updated_at
) on public.mgmail_agenda_events to authenticated;
