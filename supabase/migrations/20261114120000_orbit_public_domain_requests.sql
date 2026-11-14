-- Magnisa Orbit / Inbox — requests only, NEVER a transport or a verified identity.
-- No existing MGMail table, message, user, or Gmail connection is changed.
-- A registered domain is NOT an activated or externally routable e-mail domain.
create table public.mgmail_domain_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain_name text not null
    check (char_length(domain_name) between 4 and 253
      and domain_name=lower(domain_name)
      and domain_name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','reviewing','verified','rejected')),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  proof_reference text,
  unique(organization_id,domain_name),
  constraint mgmail_domain_proof_only_verified check (
    (status='verified' and verified_at is not null and nullif(btrim(proof_reference),'') is not null)
    or (status<>'verified' and verified_at is null)
  ),
  unique(id,organization_id,domain_name)
);
-- Pending names are NOT global locks; only an operator-verified domain is exclusive.
create unique index mgmail_unique_verified_public_domain
  on public.mgmail_domain_requests(domain_name) where status='verified';
create index mgmail_domain_requests_org_idx
  on public.mgmail_domain_requests(organization_id,created_at desc);
alter table public.mgmail_domain_requests enable row level security;
create policy mgmail_domain_requests_read on public.mgmail_domain_requests
  for select to authenticated
  using (public.has_org_permission(organization_id,'users.manage'));
create policy mgmail_domain_requests_create on public.mgmail_domain_requests
  for insert to authenticated
  with check (
    requested_by=(select auth.uid())
    and public.has_org_permission(organization_id,'users.manage')
    and status='pending' and verified_at is null and proof_reference is null
  );
revoke all on table public.mgmail_domain_requests from public,anon,authenticated;
grant select on public.mgmail_domain_requests to authenticated;
grant insert (organization_id,domain_name,requested_by)
  on public.mgmail_domain_requests to authenticated;

-- Addresses are requests linked to an EXISTING internal mailbox.
-- This must not be confused with provisioning an Internet mailbox or alias.
create table public.mgmail_public_address_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  domain_request_id uuid not null,
  domain_name text not null,
  local_part text not null
    check (char_length(local_part) between 1 and 64
      and local_part=lower(local_part)
      and local_part ~ '^[a-z0-9][a-z0-9._+-]*[a-z0-9]$'
      and local_part !~ '[.][.]'),
  email_address text generated always as (local_part || '@' || domain_name) stored,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','reviewing','approved','rejected')),
  created_at timestamptz not null default now(),
  unique(organization_id,email_address),
  constraint mgmail_public_address_same_org_mailbox
    foreign key(mailbox_id,organization_id)
    references public.mgmail_internal_mailboxes(id,organization_id) on delete restrict,
  constraint mgmail_public_address_same_org_domain
    foreign key(domain_request_id,organization_id,domain_name)
    references public.mgmail_domain_requests(id,organization_id,domain_name) on delete restrict
);
create index mgmail_public_address_request_org_idx
  on public.mgmail_public_address_requests(organization_id,created_at desc);
alter table public.mgmail_public_address_requests enable row level security;
create policy mgmail_public_address_requests_read on public.mgmail_public_address_requests
  for select to authenticated
  using (public.has_org_permission(organization_id,'users.manage'));
create policy mgmail_public_address_requests_create on public.mgmail_public_address_requests
  for insert to authenticated
  with check (
    requested_by=(select auth.uid())
    and public.has_org_permission(organization_id,'users.manage')
    and status='pending'
    and exists (
      select 1 from public.mgmail_domain_requests d
      where d.id=domain_request_id and d.organization_id=organization_id
        and d.domain_name=domain_name and d.status in ('pending','reviewing','verified')
    )
  );
revoke all on table public.mgmail_public_address_requests from public,anon,authenticated;
grant select on public.mgmail_public_address_requests to authenticated;
grant insert (organization_id,mailbox_id,domain_request_id,domain_name,local_part,requested_by)
  on public.mgmail_public_address_requests to authenticated;

-- No browser UPDATE/DELETE/verification. No API that can claim a domain is operational.
-- Future provider code must require verified DNS, ownership, sending and receiving
-- before creating any real public identities. No automatic activation from status.
