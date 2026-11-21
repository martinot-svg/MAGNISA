-- MAGNIBOX free platform-owned domains.
-- This catalogue is distinct from IANA TLD metadata and customer-owned custom domains.
-- Only platform operators may add/verify roots; organizations can reserve a ready root
-- into a unique tenant subdomain, but cannot activate mail or write routing state.

create table public.magnibox_platform_domain_catalog (
  id uuid primary key default gen_random_uuid(),
  root_domain text not null unique
    check (
      root_domain=lower(root_domain)
      and char_length(root_domain) between 4 and 253
      and root_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    ),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  category text not null default 'general',
  ownership_status text not null default 'pending'
    check (ownership_status in ('pending','verified','rejected')),
  ownership_verified_at timestamptz,
  ownership_evidence_ref text,
  mail_status text not null default 'pending'
    check (mail_status in ('pending','configuring','ready','suspended')),
  mx_verified boolean not null default false,
  spf_verified boolean not null default false,
  dkim_verified boolean not null default false,
  dmarc_verified boolean not null default false,
  is_free boolean not null default true check (is_free),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_platform_domain_ownership_evidence check (
    (ownership_status='verified'
      and ownership_verified_at is not null
      and nullif(btrim(ownership_evidence_ref),'') is not null)
    or (ownership_status<>'verified' and ownership_verified_at is null)
  ),
  constraint magnibox_platform_domain_mail_ready check (
    mail_status<>'ready'
    or (ownership_status='verified' and mx_verified and spf_verified and dkim_verified and dmarc_verified)
  ),
  constraint magnibox_platform_domain_selectable check (
    not is_active or (ownership_status='verified' and mail_status='ready')
  )
);

create index magnibox_platform_domain_available_idx
  on public.magnibox_platform_domain_catalog(category,display_name)
  where is_active and ownership_status='verified' and mail_status='ready';

alter table public.magnibox_platform_domain_catalog enable row level security;
create policy magnibox_platform_domain_catalog_available_read
  on public.magnibox_platform_domain_catalog
  for select to authenticated
  using (is_active and ownership_status='verified' and mail_status='ready');
revoke all on public.magnibox_platform_domain_catalog from public,anon,authenticated;
grant select on public.magnibox_platform_domain_catalog to authenticated;
-- Inserts/updates/deletes are intentionally reserved to the service role.

create table public.magnibox_platform_domain_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_domain_id uuid not null references public.magnibox_platform_domain_catalog(id) on delete restrict,
  root_domain text not null,
  tenant_label text not null
    check (
      tenant_label=lower(tenant_label)
      and char_length(tenant_label) between 2 and 45
      and tenant_label ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
  assigned_domain text generated always as (tenant_label || '.' || root_domain) stored,
  status text not null default 'reserved'
    check (status in ('reserved','provisioning','active','suspended','released')),
  dns_verified_at timestamptz,
  provisioning_reference text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_platform_allocation_domain_length
    check (char_length(tenant_label || '.' || root_domain) <= 253),
  constraint magnibox_platform_allocation_active_gate
    check (status<>'active' or
      (dns_verified_at is not null and nullif(btrim(provisioning_reference),'') is not null)),
  unique(id,organization_id),
  unique(assigned_domain)
);

create unique index magnibox_platform_one_current_domain_per_org
  on public.magnibox_platform_domain_allocations(organization_id)
  where status<>'released';
create index magnibox_platform_allocations_org_idx
  on public.magnibox_platform_domain_allocations(organization_id,created_at desc);

create function private.magnibox_guard_platform_domain_allocation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $allocation_guard$
declare
  v_root text;
  v_check_root boolean:=tg_op='INSERT';
begin
  -- A new allocation or a change of its domain must point to a currently
  -- selectable MAGNISA root. A later release/suspension must still be possible
  -- if the root is taken offline, so status-only cleanup does not depend on it.
  if tg_op='UPDATE' then
    v_check_root:=new.catalog_domain_id is distinct from old.catalog_domain_id
      or new.root_domain is distinct from old.root_domain
      or new.status in ('provisioning','active');
  end if;
  if v_check_root then
    select root_domain into v_root
    from public.magnibox_platform_domain_catalog
    where id=new.catalog_domain_id
      and is_active
      and ownership_status='verified'
      and mail_status='ready'
      and mx_verified and spf_verified and dkim_verified and dmarc_verified;
    if not found or new.root_domain<>v_root then
      raise exception 'Domaine MAGNIBOX indisponible ou non prêt';
    end if;
  end if;
  if new.status='active' and
    (new.dns_verified_at is null or nullif(btrim(new.provisioning_reference),'') is null) then
    raise exception 'Activation refusée sans preuve DNS et référence de provisionnement';
  end if;
  return new;
end;
$allocation_guard$;
revoke all on function private.magnibox_guard_platform_domain_allocation() from public,anon,authenticated;
create trigger trg_magnibox_guard_platform_domain_allocation
  before insert or update on public.magnibox_platform_domain_allocations
  for each row execute function private.magnibox_guard_platform_domain_allocation();

alter table public.magnibox_platform_domain_allocations enable row level security;
create policy magnibox_platform_allocations_org_read
  on public.magnibox_platform_domain_allocations
  for select to authenticated
  using (public.is_org_member(organization_id));
revoke all on public.magnibox_platform_domain_allocations from public,anon,authenticated;
grant select on public.magnibox_platform_domain_allocations to authenticated;
-- Browser writes are forbidden. Reservations go through the checked RPC below.

create or replace function public.magnibox_reserve_free_domain(
  p_organization_id uuid,
  p_catalog_domain_id uuid,
  p_tenant_label text
) returns table(allocation_id uuid,assigned_domain text,allocation_status text)
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $reserve_domain$
declare
  v_label text;
  v_catalog public.magnibox_platform_domain_catalog%rowtype;
  v_existing public.magnibox_platform_domain_allocations%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_organization_id,'users.manage') then
    raise exception 'Réservation réservée à un administrateur de l’entreprise';
  end if;

  v_label:=lower(btrim(coalesce(p_tenant_label,'')));
  if char_length(v_label)<2 or char_length(v_label)>45
    or v_label !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Identifiant public invalide';
  end if;

  select * into v_catalog
  from public.magnibox_platform_domain_catalog
  where id=p_catalog_domain_id
    and is_active
    and ownership_status='verified'
    and mail_status='ready'
    and mx_verified and spf_verified and dkim_verified and dmarc_verified
  for update;
  if not found then
    raise exception 'Ce domaine gratuit n’est pas disponible';
  end if;

  select * into v_existing
  from public.magnibox_platform_domain_allocations
  where organization_id=p_organization_id and status<>'released'
  order by created_at desc
  limit 1
  for update;
  if found then
    if v_existing.catalog_domain_id=p_catalog_domain_id and v_existing.tenant_label=v_label then
      return query select v_existing.id,v_existing.assigned_domain,v_existing.status;
      return;
    end if;
    raise exception 'Cette entreprise possède déjà une réservation de domaine MAGNIBOX';
  end if;

  insert into public.magnibox_platform_domain_allocations(
    organization_id,catalog_domain_id,root_domain,tenant_label,requested_by
  ) values (
    p_organization_id,v_catalog.id,v_catalog.root_domain,v_label,auth.uid()
  ) returning id into v_id;

  perform public.audit_event(
    p_organization_id,
    'magnibox.platform_domain.reserved',
    'magnibox_platform_domain_allocation',
    v_id,
    null,
    jsonb_build_object('domain',v_label||'.'||v_catalog.root_domain,'free',true)
  );

  return query
    select a.id,a.assigned_domain,a.status
    from public.magnibox_platform_domain_allocations a
    where a.id=v_id;
end;
$reserve_domain$;

revoke all on function public.magnibox_reserve_free_domain(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.magnibox_reserve_free_domain(uuid,uuid,text) to authenticated;

comment on table public.magnibox_platform_domain_catalog is
  'Domain roots controlled by MAGNISA and approved for free tenant-subdomain allocation. Not an IANA TLD list.';
comment on table public.magnibox_platform_domain_allocations is
  'Free per-organization subdomain reservations. Reserved does not mean mailbox or SMTP transport is active.';
