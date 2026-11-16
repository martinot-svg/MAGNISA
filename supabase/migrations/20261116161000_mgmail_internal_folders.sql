-- Dossiers personnalisés privés par collaborateur pour la messagerie interne.
create unique index if not exists mgmail_internal_messages_id_org_uidx
  on public.mgmail_internal_messages(id, organization_id);

create table if not exists public.mgmail_internal_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (id, organization_id, owner_user_id)
);
create unique index if not exists mgmail_internal_folders_name_uidx
  on public.mgmail_internal_folders(organization_id, owner_user_id, lower(name));
create index if not exists mgmail_internal_folders_owner_idx
  on public.mgmail_internal_folders(organization_id, owner_user_id, name);

alter table public.mgmail_internal_folders enable row level security;

create policy mgmail_internal_folders_select
  on public.mgmail_internal_folders for select to authenticated
  using (owner_user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy mgmail_internal_folders_insert
  on public.mgmail_internal_folders for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy mgmail_internal_folders_update
  on public.mgmail_internal_folders for update to authenticated
  using (owner_user_id = (select auth.uid()) and public.is_org_member(organization_id))
  with check (owner_user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy mgmail_internal_folders_delete
  on public.mgmail_internal_folders for delete to authenticated
  using (owner_user_id = (select auth.uid()) and public.is_org_member(organization_id));

revoke all on public.mgmail_internal_folders from anon, authenticated;
grant select, delete on public.mgmail_internal_folders to authenticated;
grant insert (organization_id, name) on public.mgmail_internal_folders to authenticated;
grant update (name) on public.mgmail_internal_folders to authenticated;

create table if not exists public.mgmail_internal_message_folders (
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  folder_id uuid not null,
  message_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (folder_id, message_id, user_id),
  constraint mgmail_message_folder_owner_same_org
    foreign key (folder_id, organization_id, user_id)
    references public.mgmail_internal_folders(id, organization_id, owner_user_id) on delete cascade,
  constraint mgmail_message_folder_message_same_org
    foreign key (message_id, organization_id)
    references public.mgmail_internal_messages(id, organization_id) on delete cascade
);
create index if not exists mgmail_internal_message_folders_message_idx
  on public.mgmail_internal_message_folders(organization_id, user_id, message_id);
alter table public.mgmail_internal_message_folders enable row level security;

create policy mgmail_internal_message_folders_select
  on public.mgmail_internal_message_folders for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_messages m
      where m.id = message_id and m.organization_id = mgmail_internal_message_folders.organization_id
      and (
        public.mgmail_has_internal_access(m.organization_id, m.sender_mailbox_id, 'read')
        or public.mgmail_has_internal_access(m.organization_id, m.recipient_mailbox_id, 'read')
      )
    )
  );

create policy mgmail_internal_message_folders_insert
  on public.mgmail_internal_message_folders for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_folders f
      where f.id = folder_id and f.organization_id = mgmail_internal_message_folders.organization_id
        and f.owner_user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.mgmail_internal_messages m
      where m.id = message_id and m.organization_id = mgmail_internal_message_folders.organization_id
      and (
        public.mgmail_has_internal_access(m.organization_id, m.sender_mailbox_id, 'read')
        or public.mgmail_has_internal_access(m.organization_id, m.recipient_mailbox_id, 'read')
      )
    )
  );

create policy mgmail_internal_message_folders_delete
  on public.mgmail_internal_message_folders for delete to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_folders f
      where f.id = folder_id and f.organization_id = mgmail_internal_message_folders.organization_id
        and f.owner_user_id = (select auth.uid())
    )
  );

revoke all on public.mgmail_internal_message_folders from anon, authenticated;
grant select, delete on public.mgmail_internal_message_folders to authenticated;
grant insert (organization_id, folder_id, message_id) on public.mgmail_internal_message_folders to authenticated;
