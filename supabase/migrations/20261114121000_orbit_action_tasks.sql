-- Magnisa Orbit Action: collaborative tasks are independent of financial project status.
-- No historical commercial project, MGMail mailbox or existing message is modified.
-- Composite FK ensures optional project links never cross organizations.
create unique index if not exists orbit_projects_id_org_unique_idx
  on public.projects(id,organization_id);

create table public.orbit_action_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  parent_task_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text not null default '' check (char_length(description)<=10000),
  status text not null default 'todo' check (status in ('todo','in_progress','review','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  constraint orbit_action_project_same_org
    foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  constraint orbit_action_parent_same_org
    foreign key(parent_task_id,organization_id) references public.orbit_action_tasks(id,organization_id) on delete restrict,
  constraint orbit_action_no_self_parent check (parent_task_id is null or id<>parent_task_id)
);
create index orbit_action_org_status_idx
  on public.orbit_action_tasks(organization_id,status,created_at desc);
create index orbit_action_org_due_idx
  on public.orbit_action_tasks(organization_id,due_date)
  where due_date is not null and status<>'done';
create index orbit_action_assignee_idx
  on public.orbit_action_tasks(organization_id,assigned_to,status);
alter table public.orbit_action_tasks enable row level security;

-- The assignee must still be active inside the exact same organization.
-- This is evaluated for API writes as well as server actions.
create policy orbit_action_tasks_read on public.orbit_action_tasks
  for select to authenticated
  using (public.is_org_member(organization_id));
create policy orbit_action_tasks_create on public.orbit_action_tasks
  for insert to authenticated with check (
    public.is_org_member(organization_id)
    and created_by=(select auth.uid())
    and (assigned_to is null or exists (
      select 1 from public.organization_members m
        where m.organization_id=orbit_action_tasks.organization_id
          and m.user_id=orbit_action_tasks.assigned_to and m.status='active'
    ))
    and (project_id is null or public.has_org_permission(organization_id,'sales.view'))
  );
create policy orbit_action_tasks_update on public.orbit_action_tasks
  for update to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by=(select auth.uid()) or assigned_to=(select auth.uid())
         or public.has_org_permission(organization_id,'users.manage'))
  )
  with check (
    public.is_org_member(organization_id)
    and (created_by=(select auth.uid()) or assigned_to=(select auth.uid())
         or public.has_org_permission(organization_id,'users.manage'))
    and (assigned_to is null or exists (
      select 1 from public.organization_members m
        where m.organization_id=orbit_action_tasks.organization_id
          and m.user_id=orbit_action_tasks.assigned_to and m.status='active'
    ))
  );

revoke all on public.orbit_action_tasks from public,anon,authenticated;
grant select on public.orbit_action_tasks to authenticated;
grant insert (
  organization_id,project_id,parent_task_id,created_by,assigned_to,
  title,description,status,priority,due_date
) on public.orbit_action_tasks to authenticated;
grant update (
  title,description,status,priority,due_date,assigned_to,updated_at
) on public.orbit_action_tasks to authenticated;

-- Comments are append-only to preserve the collaboration record.
create table public.orbit_action_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check(char_length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  constraint orbit_action_comment_task_same_org
    foreign key(task_id,organization_id)
    references public.orbit_action_tasks(id,organization_id) on delete restrict
);
create index orbit_action_comments_task_idx
  on public.orbit_action_comments(organization_id,task_id,created_at);
alter table public.orbit_action_comments enable row level security;
create policy orbit_action_comments_read on public.orbit_action_comments
  for select to authenticated
  using(public.is_org_member(organization_id));
create policy orbit_action_comments_create on public.orbit_action_comments
  for insert to authenticated
  with check(public.is_org_member(organization_id)
    and author_user_id=(select auth.uid()));
revoke all on public.orbit_action_comments from public,anon,authenticated;
grant select on public.orbit_action_comments to authenticated;
grant insert(organization_id,task_id,author_user_id,body)
  on public.orbit_action_comments to authenticated;

-- No authenticated DELETE. Historical projects and messages remain intact.
