-- MGMail interne : identifiants d'entreprise et boîtes pour collaborateurs.
-- `*.mgmail` est un espace privé MAGNISA, pas une adresse Internet publique.
-- Ce lot ne prétend pas acheminer du courrier vers Gmail/Outlook.
create table if not exists public.mgmail_internal_namespaces (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 45),
  created_at timestamptz not null default now()
);

create table if not exists public.mgmail_internal_mailboxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  local_part text not null
    check (local_part ~ '^[a-z][a-z0-9._-]*$' and char_length(local_part) between 2 and 64),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null default ''
    check (char_length(display_name) <= 120),
  is_active boolean not null default true,
  can_read boolean not null default true,
  can_send boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, local_part)
);

create index if not exists mgmail_mailboxes_assignee_idx
  on public.mgmail_internal_mailboxes (organization_id, owner_user_id);

create table if not exists public.mgmail_internal_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  sender_mailbox_id uuid not null references public.mgmail_internal_mailboxes(id) on delete restrict,
  recipient_mailbox_id uuid not null references public.mgmail_internal_mailboxes(id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 180),
  body_text text not null check (char_length(body_text) between 1 and 50000),
  created_at timestamptz not null default now()
);

create index if not exists mgmail_message_recipient_idx
  on public.mgmail_internal_messages (organization_id, recipient_mailbox_id, created_at desc);
create index if not exists mgmail_message_sender_idx
  on public.mgmail_internal_messages (organization_id, sender_mailbox_id, created_at desc);

alter table public.mgmail_internal_namespaces enable row level security;
alter table public.mgmail_internal_mailboxes enable row level security;
alter table public.mgmail_internal_messages enable row level security;

create policy mgmail_namespaces_select
  on public.mgmail_internal_namespaces for select to authenticated
  using (public.is_org_member(organization_id));

create policy mgmail_namespaces_insert
  on public.mgmail_internal_namespaces for insert to authenticated
  with check (public.has_org_permission(organization_id, 'users.manage'));

create policy mgmail_mailboxes_select
  on public.mgmail_internal_mailboxes for select to authenticated
  using (public.is_org_member(organization_id));

create policy mgmail_mailboxes_insert
  on public.mgmail_internal_mailboxes for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'users.manage')
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = mgmail_internal_mailboxes.organization_id
        and om.user_id = owner_user_id
        and om.status = 'active'
    )
  );

create policy mgmail_mailboxes_update
  on public.mgmail_internal_mailboxes for update to authenticated
  using (public.has_org_permission(organization_id, 'users.manage'))
  with check (
    public.has_org_permission(organization_id, 'users.manage')
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = mgmail_internal_mailboxes.organization_id
        and om.user_id = owner_user_id
        and om.status = 'active'
    )
  );

create policy mgmail_messages_select
  on public.mgmail_internal_messages for select to authenticated
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_mailboxes mailbox
      where mailbox.organization_id = mgmail_internal_messages.organization_id
        and mailbox.owner_user_id = auth.uid()
        and mailbox.is_active and mailbox.can_read
        and mailbox.id in (sender_mailbox_id, recipient_mailbox_id)
    )
  );

create policy mgmail_messages_insert
  on public.mgmail_internal_messages for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.mgmail_internal_mailboxes sender
      where sender.organization_id = mgmail_internal_messages.organization_id
        and sender.id = sender_mailbox_id
        and sender.owner_user_id = auth.uid()
        and sender.is_active and sender.can_send
    )
    and exists (
      select 1 from public.mgmail_internal_mailboxes recipient
      where recipient.organization_id = mgmail_internal_messages.organization_id
        and recipient.id = recipient_mailbox_id
        and recipient.is_active
    )
  );

-- Retirer TRUNCATE, DELETE et les modifications de propriété implicites.
revoke all on table public.mgmail_internal_namespaces from anon, authenticated;
revoke all on table public.mgmail_internal_mailboxes from anon, authenticated;
revoke all on table public.mgmail_internal_messages from anon, authenticated;
grant select, insert (organization_id, slug)
  on public.mgmail_internal_namespaces to authenticated;
grant select, insert (organization_id, local_part, owner_user_id, display_name),
  update (display_name, is_active, can_read, can_send)
  on public.mgmail_internal_mailboxes to authenticated;
grant select, insert (
  organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
) on public.mgmail_internal_messages to authenticated;
