-- MAGNISA — Chantier 2 : réservation temporelle de ressources.
-- Uses a PostgreSQL exclusion constraint to prevent overlapping active bookings.
create extension if not exists btree_gist;

create table if not exists public.reservable_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  resource_type text not null default 'other'
    check (resource_type in ('room','vehicle','equipment','staff','other')),
  description text,
  capacity integer check (capacity is null or capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index if not exists reservable_resources_org_name_unique
  on public.reservable_resources(organization_id, lower(trim(name)));

create table if not exists public.resource_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource_id uuid not null,
  customer_id uuid,
  service_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone_name text not null,
  status text not null default 'confirmed'
    check (status in ('held','confirmed','cancelled','completed')),
  idempotency_key uuid not null,
  notes text,
  created_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_reservations_period_check check (end_at > start_at),
  constraint resource_reservations_resource_org_fk
    foreign key (organization_id, resource_id)
    references public.reservable_resources(organization_id,id) on delete restrict,
  constraint resource_reservations_customer_org_fk
    foreign key (organization_id, customer_id)
    references public.customers(organization_id,id) on delete restrict,
  constraint resource_reservations_service_org_fk
    foreign key (organization_id, service_id)
    references public.services(organization_id,id) on delete restrict,
  constraint resource_reservations_idempotency_unique unique (organization_id,idempotency_key)
);

-- Half-open time ranges: a booking ending at 10:00 does not conflict with one starting at 10:00.
alter table public.resource_reservations
  add constraint resource_reservations_no_overlap
  exclude using gist (
    organization_id with =,
    resource_id with =,
    tstzrange(start_at,end_at,'[)') with &&
  ) where (status in ('held','confirmed'));

create index if not exists resource_reservations_org_start_idx
  on public.resource_reservations(organization_id,start_at);
create index if not exists resource_reservations_resource_start_idx
  on public.resource_reservations(organization_id,resource_id,start_at);

alter table public.reservable_resources enable row level security;
alter table public.resource_reservations enable row level security;

drop policy if exists reservable_resources_select on public.reservable_resources;
create policy reservable_resources_select on public.reservable_resources
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'orders.manage')
);

drop policy if exists resource_reservations_select on public.resource_reservations;
create policy resource_reservations_select on public.resource_reservations
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'orders.manage')
);

create or replace function public.create_reservable_resource(
  p_org uuid,p_name text,p_type text,p_description text,p_capacity integer
) returns uuid
language plpgsql security definer set search_path=public as $function$
declare v_id uuid;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'orders.manage');
  if p_name is null or length(trim(p_name))<2 then raise exception 'Nom de ressource invalide'; end if;
  if p_type is null or p_type not in ('room','vehicle','equipment','staff','other') then raise exception 'Type de ressource invalide'; end if;
  if p_capacity is not null and p_capacity<=0 then raise exception 'Capacité invalide'; end if;
  insert into public.reservable_resources(organization_id,name,resource_type,description,capacity)
  values(p_org,trim(p_name),p_type,nullif(trim(coalesce(p_description,'')),''),p_capacity)
  returning id into v_id;
  perform public.audit_event(p_org,'resource.created','reservable_resource',v_id,null,jsonb_build_object('name',trim(p_name),'resource_type',p_type));
  return v_id;
end;
$function$;

create or replace function public.create_resource_reservation(
  p_org uuid,p_resource uuid,p_customer uuid,p_service uuid,
  p_start_at timestamptz,p_end_at timestamptz,p_timezone text,
  p_idempotency_key uuid,p_notes text default null
) returns uuid
language plpgsql security definer set search_path=public as $function$
declare v_id uuid; v_existing public.resource_reservations%rowtype;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'orders.manage');
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at or p_start_at<=now() then raise exception 'Période de réservation invalide'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Fuseau horaire invalide'; end if;
  if p_idempotency_key is null then raise exception 'Clé d’idempotence requise'; end if;
  if not exists(select 1 from public.reservable_resources where id=p_resource and organization_id=p_org and is_active) then raise exception 'Ressource introuvable ou inactive'; end if;
  if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and organization_id=p_org and is_active) then raise exception 'Client invalide'; end if;
  if p_service is not null and not exists(select 1 from public.services where id=p_service and organization_id=p_org and is_active) then raise exception 'Prestation invalide'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_idempotency_key::text,0));
  select * into v_existing from public.resource_reservations where organization_id=p_org and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.resource_id=p_resource and v_existing.customer_id is not distinct from p_customer
      and v_existing.service_id is not distinct from p_service
      and v_existing.start_at=p_start_at and v_existing.end_at=p_end_at
      and v_existing.timezone_name=p_timezone then return v_existing.id;
    end if;
    raise exception 'Clé d’idempotence déjà utilisée pour une autre réservation';
  end if;

  insert into public.resource_reservations(
    organization_id,resource_id,customer_id,service_id,start_at,end_at,timezone_name,
    idempotency_key,notes,created_by
  ) values(p_org,p_resource,p_customer,p_service,p_start_at,p_end_at,p_timezone,p_idempotency_key,
    nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into v_id;
  perform public.audit_event(p_org,'resource_reservation.created','resource_reservation',v_id,null,
    jsonb_build_object('resource_id',p_resource,'start_at',p_start_at,'end_at',p_end_at,'timezone',p_timezone));
  return v_id;
exception when exclusion_violation then
  raise exception 'Cette ressource est déjà réservée sur tout ou partie de cette période';
end;
$function$;

create or replace function public.update_resource_reservation_period(
  p_org uuid,p_reservation uuid,p_start_at timestamptz,p_end_at timestamptz,p_timezone text
) returns uuid
language plpgsql security definer set search_path=public as $function$
declare v_old public.resource_reservations%rowtype;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'orders.manage');
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at or p_start_at<=now() then raise exception 'Période de réservation invalide'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Fuseau horaire invalide'; end if;
  select * into v_old from public.resource_reservations
    where id=p_reservation and organization_id=p_org and status in ('held','confirmed') for update;
  if not found then raise exception 'Réservation introuvable ou non modifiable'; end if;
  update public.resource_reservations set start_at=p_start_at,end_at=p_end_at,timezone_name=p_timezone,updated_at=now()
    where id=p_reservation and organization_id=p_org;
  perform public.audit_event(p_org,'resource_reservation.period_updated','resource_reservation',p_reservation,
    jsonb_build_object('start_at',v_old.start_at,'end_at',v_old.end_at,'timezone',v_old.timezone_name),
    jsonb_build_object('start_at',p_start_at,'end_at',p_end_at,'timezone',p_timezone));
  return p_reservation;
exception when exclusion_violation then
  raise exception 'Cette ressource est déjà réservée sur tout ou partie de cette période';
end;
$function$;

create or replace function public.cancel_resource_reservation(
  p_org uuid,p_reservation uuid,p_reason text
) returns uuid
language plpgsql security definer set search_path=public as $function$
declare v_old public.resource_reservations%rowtype;
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org,'orders.manage');
  if p_reason is null or length(trim(p_reason))<3 then raise exception 'Motif d’annulation requis'; end if;
  select * into v_old from public.resource_reservations
    where id=p_reservation and organization_id=p_org and status in ('held','confirmed') for update;
  if not found then raise exception 'Réservation introuvable ou déjà clôturée'; end if;
  update public.resource_reservations set status='cancelled',cancelled_at=now(),
    cancellation_reason=trim(p_reason),updated_at=now()
    where id=p_reservation and organization_id=p_org;
  perform public.audit_event(p_org,'resource_reservation.cancelled','resource_reservation',p_reservation,
    jsonb_build_object('status',v_old.status),jsonb_build_object('status','cancelled','reason',trim(p_reason)));
  return p_reservation;
end;
$function$;

revoke all on function public.create_reservable_resource(uuid,text,text,text,integer) from public,anon;
grant execute on function public.create_reservable_resource(uuid,text,text,text,integer) to authenticated;
revoke all on function public.create_resource_reservation(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) from public,anon;
grant execute on function public.create_resource_reservation(uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,uuid,text) to authenticated;
revoke all on function public.update_resource_reservation_period(uuid,uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.update_resource_reservation_period(uuid,uuid,timestamptz,timestamptz,text) to authenticated;
revoke all on function public.cancel_resource_reservation(uuid,uuid,text) from public,anon;
grant execute on function public.cancel_resource_reservation(uuid,uuid,text) to authenticated;
