-- MGMail external mail via Resend: verified sender/receiver identities, no Gmail dependency.
-- An authorized backend may provision public identities ONLY after actual domain/DNS
-- verification. Browser clients cannot INSERT/UPDATE identities or forge delivery states.
alter table public.mgmail_internal_mailboxes
  add column if not exists can_external_read boolean not null default false,
  add column if not exists can_external_send boolean not null default false;

alter table public.mgmail_internal_mailbox_grants
  add column if not exists can_external_read boolean not null default false,
  add column if not exists can_external_send boolean not null default false;

grant update (can_external_read,can_external_send)
  on public.mgmail_internal_mailboxes to authenticated;
grant update (can_external_read,can_external_send)
  on public.mgmail_internal_mailbox_grants to authenticated;

create table if not exists public.mgmail_external_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  email_address text not null unique
    check (email_address = lower(email_address)
      and email_address ~ '^[a-z0-9][a-z0-9._+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
      and char_length(email_address) <= 254),
  provider text not null default 'resend' check(provider='resend'),
  status text not null default 'pending'
    check(status in ('pending','active','suspended')),
  receive_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id,organization_id),
  constraint mgmail_external_identity_internal_mailbox
    foreign key(mailbox_id,organization_id)
      references public.mgmail_internal_mailboxes(id,organization_id)
      on delete cascade
);
create index if not exists mgmail_external_identities_org_idx
  on public.mgmail_external_identities(organization_id,mailbox_id);
alter table public.mgmail_external_identities enable row level security;

create or replace function public.mgmail_can_external_access(
  p_org uuid,p_mailbox uuid,p_action text
) returns boolean
language sql stable security invoker
set search_path=pg_catalog,public
as $external$
  select p_action in ('read','send')
    and public.mgmail_has_internal_access(p_org,p_mailbox,p_action)
    and exists (
      select 1 from public.mgmail_internal_mailboxes b
      where b.organization_id=p_org and b.id=p_mailbox and b.is_active
        and (
          (b.owner_user_id=(select auth.uid())
            and case when p_action='read'
              then b.can_external_read else b.can_external_send end)
          or exists (
            select 1 from public.mgmail_internal_mailbox_grants g
            where g.organization_id=b.organization_id
              and g.mailbox_id=b.id and g.user_id=(select auth.uid())
              and g.is_active
              and case when p_action='read'
                then g.can_external_read else g.can_external_send end
          )
        )
    );
$external$;
revoke all on function public.mgmail_can_external_access(uuid,uuid,text) from public,anon;
grant execute on function public.mgmail_can_external_access(uuid,uuid,text) to authenticated;

create policy mgmail_external_identity_select
  on public.mgmail_external_identities for select to authenticated
  using (
    public.has_org_permission(organization_id,'users.manage')
    or public.mgmail_has_internal_access(organization_id,mailbox_id,'read')
    or public.mgmail_has_internal_access(organization_id,mailbox_id,'send')
  );
revoke all on public.mgmail_external_identities from anon,authenticated;
grant select on public.mgmail_external_identities to authenticated;

create table if not exists public.mgmail_external_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity_id uuid not null,
  direction text not null check(direction in ('incoming','outgoing')),
  status text not null check(status in (
    'queued','sending','accepted','delivered','failed','bounced','received'
  )),
  from_email text not null,
  to_emails text[] not null default '{}',
  subject text not null check(char_length(subject) between 1 and 180),
  body_text text not null default '' check(char_length(body_text) <= 50000),
  provider_email_id text,
  request_key uuid,
  created_by uuid references auth.users(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mgmail_external_message_identity_org
    foreign key(identity_id,organization_id)
      references public.mgmail_external_identities(id,organization_id)
      on delete cascade,
  constraint mgmail_external_valid_state check (
    (direction='incoming' and status='received' and request_key is null)
    or (direction='outgoing' and status<>'received')
  )
);
create unique index if not exists mgmail_external_provider_msg_uidx
  on public.mgmail_external_messages(identity_id,direction,provider_email_id)
  where provider_email_id is not null;
create unique index if not exists mgmail_external_request_uidx
  on public.mgmail_external_messages(identity_id,request_key)
  where request_key is not null;
create index if not exists mgmail_external_inbox_idx
  on public.mgmail_external_messages(organization_id,identity_id,created_at desc);
alter table public.mgmail_external_messages enable row level security;
create policy mgmail_external_messages_select
  on public.mgmail_external_messages for select to authenticated
  using (
    exists (
      select 1 from public.mgmail_external_identities identity
      where identity.id=mgmail_external_messages.identity_id
        and identity.organization_id=mgmail_external_messages.organization_id
        and public.mgmail_can_external_access(
          identity.organization_id,identity.mailbox_id,'read')
    )
  );
revoke all on public.mgmail_external_messages from anon,authenticated;
grant select on public.mgmail_external_messages to authenticated;

-- Only service_role (not browser sessions) may provision identities or record mail.
-- A public alias like @mitalia.digital is not automatically provisioned by MAGNISA.
