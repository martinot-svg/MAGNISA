-- Magnibox: real Internet identities and messages (NO provider activation).
-- Depends on 20261114120000 domain requests. No historical MGMail data modified.
create unique index orbit_address_request_identity_reference_idx
  on public.mgmail_public_address_requests
  (id,organization_id,domain_name,local_part,mailbox_id);

create table public.orbit_public_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  domain_request_id uuid not null,
  address_request_id uuid not null,
  mailbox_id uuid not null,
  domain_name text not null,
  local_part text not null,
  email_address text generated always as (local_part || '@' || domain_name) stored,
  provider text not null check(provider in ('resend','smtp','microsoft_graph')),
  provider_domain_ref text,
  provider_verified_at timestamptz,
  status text not null default 'pending'
    check(status in ('pending','active','suspended')),
  receive_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(email_address),
  constraint orbit_identity_mailbox_same_org
    foreign key(mailbox_id,organization_id)
      references public.mgmail_internal_mailboxes(id,organization_id) on delete restrict,
  constraint orbit_identity_domain_same_org
    foreign key(domain_request_id,organization_id,domain_name)
      references public.mgmail_domain_requests(id,organization_id,domain_name)
      on delete restrict,
  constraint orbit_identity_requested_address_same_org
    foreign key(address_request_id,organization_id,domain_name,local_part,mailbox_id)
      references public.mgmail_public_address_requests
        (id,organization_id,domain_name,local_part,mailbox_id)
      on delete restrict,
  constraint orbit_identity_activation_requires_provider
    check(status<>'active' or
      (provider_verified_at is not null and nullif(btrim(provider_domain_ref),'') is not null)),
  constraint orbit_identity_receiving_only_while_active
    check(not receive_enabled or status='active')
);
create index orbit_identity_org_idx
  on public.orbit_public_identities(organization_id,mailbox_id,status);
alter table public.orbit_public_identities enable row level security;

-- Additional external permissions are distinct from existing internal rights.
-- Service role provisions and revokes; browsers may only view authorized grants.
create table public.orbit_external_mailbox_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_read boolean not null default false,
  can_send boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(organization_id,identity_id,user_id),
  constraint orbit_external_access_identity_same_org
    foreign key(identity_id,organization_id)
      references public.orbit_public_identities(id,organization_id) on delete cascade
);
create index orbit_external_access_user_idx
  on public.orbit_external_mailbox_access(user_id,organization_id)
  where is_active;
alter table public.orbit_external_mailbox_access enable row level security;
create policy orbit_external_access_read on public.orbit_external_mailbox_access
  for select to authenticated using (
    public.has_org_permission(organization_id,'users.manage')
    or (user_id=(select auth.uid()) and public.is_org_member(organization_id))
  );

create policy orbit_public_identities_read on public.orbit_public_identities
  for select to authenticated using (
    public.has_org_permission(organization_id,'users.manage')
    or (public.is_org_member(organization_id) and exists (
      select 1 from public.orbit_external_mailbox_access g
      where g.identity_id=orbit_public_identities.id
        and g.organization_id=orbit_public_identities.organization_id
        and g.user_id=(select auth.uid()) and g.is_active
        and ((g.can_read and public.mgmail_has_internal_access(
          orbit_public_identities.organization_id,orbit_public_identities.mailbox_id,'read'))
          or (g.can_send and public.mgmail_has_internal_access(
          orbit_public_identities.organization_id,orbit_public_identities.mailbox_id,'send')))
    ))
  );

-- Both external and internal permissions must hold for each action;
-- the active-member check runs against current database membership, not old JWT claims.
create function public.orbit_can_public_mail_access(
  p_org uuid,p_identity uuid,p_action text
) returns boolean language sql stable security invoker
set search_path=pg_catalog,public
as $orbit_access$
  select p_action in ('read','send') and public.is_org_member(p_org)
    and exists (
      select 1 from public.orbit_public_identities i
      join public.orbit_external_mailbox_access g
        on g.identity_id=i.id and g.organization_id=i.organization_id
      where i.organization_id=p_org and i.id=p_identity
        and g.user_id=(select auth.uid()) and g.is_active
        and (p_action='read' or i.status='active')
        and (case when p_action='read' then g.can_read else g.can_send end)
        and public.mgmail_has_internal_access(p_org,i.mailbox_id,p_action)
    );
$orbit_access$;
revoke all on function public.orbit_can_public_mail_access(uuid,uuid,text)
  from public,anon;
grant execute on function public.orbit_can_public_mail_access(uuid,uuid,text)
  to authenticated;

-- Browser cannot mark any domain, address or identity active. Even a privileged
-- service update must be rejected without verified DNS and approved address.
create function private.orbit_public_identity_activation_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $orbit_guard$
begin
  if new.status='active' and not exists (
    select 1 from public.mgmail_domain_requests d
    join public.mgmail_public_address_requests a
      on a.domain_request_id=d.id and a.organization_id=d.organization_id
    where d.id=new.domain_request_id and d.organization_id=new.organization_id
      and d.domain_name=new.domain_name and d.status='verified'
      and a.id=new.address_request_id and a.status='approved'
      and a.mailbox_id=new.mailbox_id and a.local_part=new.local_part
  ) then
    raise exception 'Internet sender requires verified domain and approved address';
  end if;
  return new;
end;
$orbit_guard$;
revoke all on function private.orbit_public_identity_activation_guard()
  from public,anon,authenticated;
create trigger trg_orbit_identity_activation
  before insert or update on public.orbit_public_identities
  for each row execute function private.orbit_public_identity_activation_guard();

-- Ownership revocation suspends all corresponding public identities immediately.
create function private.orbit_suspend_unverified_public_domain()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $orbit_revoke$
begin
  if old.status='verified' and new.status<>'verified' then
    update public.orbit_public_identities set
      status='suspended',receive_enabled=false,updated_at=now()
      where domain_request_id=new.id and organization_id=new.organization_id
        and status='active';
  end if;
  return new;
end;
$orbit_revoke$;
revoke all on function private.orbit_suspend_unverified_public_domain()
  from public,anon,authenticated;
create trigger trg_orbit_domain_unverified
  after update of status on public.mgmail_domain_requests
  for each row execute function private.orbit_suspend_unverified_public_domain();

-- Internet messages are segregated from internal MGMail messages.
create table public.orbit_external_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  identity_id uuid not null,
  direction text not null check(direction in ('incoming','outgoing')),
  status text not null check(status in (
    'queued','sending','accepted','delivered','failed','bounced','uncertain','received'
  )),
  from_email text not null,
  to_emails text[] not null default '{}',
  subject text not null check(char_length(subject) between 1 and 180),
  body_text text not null default '' check(char_length(body_text)<=50000),
  provider_email_id text,
  request_key uuid,
  created_by uuid references auth.users(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orbit_external_message_identity_same_org
    foreign key(identity_id,organization_id)
      references public.orbit_public_identities(id,organization_id) on delete restrict,
  constraint orbit_external_message_direction_status
    check((direction='incoming' and status='received' and request_key is null)
      or (direction='outgoing' and status<>'received'))
);
create unique index orbit_external_provider_message_idx
  on public.orbit_external_messages(identity_id,direction,provider_email_id)
  where provider_email_id is not null;
create unique index orbit_external_request_message_idx
  on public.orbit_external_messages(identity_id,request_key)
  where request_key is not null;
create index orbit_external_org_message_idx
  on public.orbit_external_messages(organization_id,identity_id,created_at desc);
alter table public.orbit_external_messages enable row level security;
create policy orbit_external_messages_read on public.orbit_external_messages
  for select to authenticated using (
    public.orbit_can_public_mail_access(organization_id,identity_id,'read')
    or (direction='outgoing' and created_by=(select auth.uid())
      and public.orbit_can_public_mail_access(organization_id,identity_id,'send'))
  );
revoke all on public.orbit_public_identities from public,anon,authenticated;
revoke all on public.orbit_external_mailbox_access from public,anon,authenticated;
revoke all on public.orbit_external_messages from public,anon,authenticated;
grant select on public.orbit_public_identities to authenticated;
grant select on public.orbit_external_mailbox_access to authenticated;
grant select on public.orbit_external_messages to authenticated;

-- No sender provisioning endpoints or webhooks are activated by this migration.
-- Only trusted, verified server-side transport may write external mail.
