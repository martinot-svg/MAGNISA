-- MGMail: request an Internet domain without granting activation rights to tenants.
-- Only a privileged, audited operator may register a provider-verified domain.
create table public.mgmail_domain_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain_name text not null check (
    domain_name = lower(domain_name)
    and domain_name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and char_length(domain_name) between 4 and 253
  ),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,domain_name)
);
alter table public.mgmail_domain_requests enable row level security;
create policy mgmail_domain_requests_read on public.mgmail_domain_requests
  for select to authenticated
  using(public.has_org_permission(organization_id,'users.manage'));
create policy mgmail_domain_requests_create on public.mgmail_domain_requests
  for insert to authenticated
  with check(
    requested_by=(select auth.uid())
    and public.has_org_permission(organization_id,'users.manage')
    and status='pending'
  );
revoke all on public.mgmail_domain_requests from public,anon,authenticated;
grant select on public.mgmail_domain_requests to authenticated;
grant insert(organization_id,domain_name,requested_by)
  on public.mgmail_domain_requests to authenticated;

-- Operator-managed proof: an existing, genuinely verified provider domain.
-- This table has no browser INSERT, UPDATE or DELETE permissions.
create table public.mgmail_verified_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain_name text not null unique,
  provider text not null default 'resend' check(provider='resend'),
  provider_domain_id text not null unique check(char_length(provider_domain_id) between 5 and 128),
  sending_verified boolean not null default false,
  receiving_verified boolean not null default false,
  ownership_approved boolean not null default false,
  operator_reference text not null check(char_length(operator_reference) between 3 and 128),
  provider_checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  constraint mgmail_verified_domain_format check(
    domain_name = lower(domain_name)
    and domain_name ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and char_length(domain_name) between 4 and 253
  )
);
alter table public.mgmail_verified_domains enable row level security;
create policy mgmail_verified_domains_admin_read
  on public.mgmail_verified_domains for select to authenticated
  using (public.has_org_permission(organization_id,'users.manage'));
revoke all on public.mgmail_verified_domains from public,anon,authenticated;
grant select on public.mgmail_verified_domains to authenticated;

alter table public.mgmail_external_identities
  add column verified_domain_id uuid;
alter table public.mgmail_external_identities
  add constraint mgmail_identity_approved_domain_org_fk
  foreign key(verified_domain_id,organization_id)
  references public.mgmail_verified_domains(id,organization_id)
  on delete restrict;

-- Previously provisioned identities with no domain proof are not eligible
-- for public traffic. A pending identity remains pending until approved.
update public.mgmail_external_identities
  set status='suspended',receive_enabled=false
  where status='active' and verified_domain_id is null;

-- Defence in depth for all writes, even those using the service role.
create or replace function private.mgmail_require_verified_domain()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,private
as $verified$
declare
  verified record;
begin
  if new.status <> 'active' then
    if new.receive_enabled then
      raise exception 'Réception activée sans identité active' using errcode='23514';
    end if;
    return new;
  end if;
  if new.verified_domain_id is null then
    raise exception 'Domaine MGMail non vérifié' using errcode='23514';
  end if;
  select domain_name,sending_verified,receiving_verified,ownership_approved
    into verified
    from public.mgmail_verified_domains
    where id=new.verified_domain_id and organization_id=new.organization_id
      and provider=new.provider;
  if not found or not coalesce(verified.ownership_approved,false) or
      not coalesce(verified.sending_verified,false) or
      split_part(new.email_address,'@',2) is distinct from verified.domain_name or
      (new.receive_enabled and not coalesce(verified.receiving_verified,false)) then
    raise exception 'Identité MGMail refusée : domaine ou réception non validé'
      using errcode='23514';
  end if;
  return new;
end;
$verified$;
revoke all on function private.mgmail_require_verified_domain()
  from public,anon,authenticated;
drop trigger if exists trg_mgmail_require_verified_domain
  on public.mgmail_external_identities;
create trigger trg_mgmail_require_verified_domain
  before insert or update of status,receive_enabled,email_address,verified_domain_id,organization_id,provider
  on public.mgmail_external_identities
  for each row execute function private.mgmail_require_verified_domain();

-- Revoke sending/receiving for any previously active identity if its
-- operator-approved domain is later suspended or its capabilities removed.
create or replace function private.mgmail_suspend_unverified_domain_identities()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $suspend$
begin
  if not new.ownership_approved or not new.sending_verified then
    update public.mgmail_external_identities
      set status='suspended',receive_enabled=false
      where verified_domain_id=new.id and organization_id=new.organization_id
        and status='active';
  elsif not new.receiving_verified then
    update public.mgmail_external_identities
      set receive_enabled=false
      where verified_domain_id=new.id and organization_id=new.organization_id
        and status='active' and receive_enabled=true;
  end if;
  return new;
end;
$suspend$;
revoke all on function private.mgmail_suspend_unverified_domain_identities()
  from public,anon,authenticated;
create trigger trg_mgmail_suspend_unverified_domain_identities
  after update of ownership_approved,sending_verified,receiving_verified
  on public.mgmail_verified_domains for each row
  execute function private.mgmail_suspend_unverified_domain_identities();
