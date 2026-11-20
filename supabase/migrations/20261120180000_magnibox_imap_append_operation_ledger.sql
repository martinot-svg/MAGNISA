-- Durable, lease-fenced IMAP APPEND operation ledger.
-- The marker is generated once by PostgreSQL and reused across worker retries.
begin;

create table public.magnibox_imap_append_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbox_event_id uuid not null references public.magnibox_sync_outbox(id) on delete cascade,
  target_mailbox_id uuid not null,
  folder_state_id uuid not null,
  marker text not null unique
    default ('mbxop-' || gen_random_uuid()::text)
    check (marker ~ '^mbxop-[0-9a-f-]{36}$'),
  state text not null default 'ready'
    check (state in ('ready', 'append_started', 'ambiguous', 'confirmed')),
  uidvalidity bigint not null check (uidvalidity > 0),
  imap_uid bigint check (imap_uid is null or imap_uid > 0),
  attempts integer not null default 0 check (attempts >= 0),
  append_started_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_imap_append_folder_org_fk
    foreign key (folder_state_id, organization_id)
    references public.magnibox_imap_folder_state(id, organization_id) on delete restrict,
  constraint magnibox_imap_append_state_uid_ck check (
    (state = 'confirmed' and imap_uid is not null and confirmed_at is not null)
    or (state <> 'confirmed' and imap_uid is null and confirmed_at is null)
  ),
  constraint magnibox_imap_append_started_ck check (
    (state in ('append_started', 'ambiguous', 'confirmed') and append_started_at is not null)
    or (state = 'ready' and append_started_at is null)
  ),
  unique (organization_id, outbox_event_id, target_mailbox_id, folder_state_id)
);

create index magnibox_imap_append_recovery_idx
  on public.magnibox_imap_append_operations(organization_id, state, updated_at)
  where state in ('append_started', 'ambiguous');

create function private.magnibox_validate_imap_append_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $validate_append$
declare
  v_event public.magnibox_sync_outbox%rowtype;
  v_folder public.magnibox_imap_folder_state%rowtype;
begin
  select o.* into v_event
  from public.magnibox_sync_outbox o
  where o.id = new.outbox_event_id
    and o.organization_id = new.organization_id;

  if not found
    or v_event.aggregate_type <> 'internal_message'
    or v_event.event_type not in ('message.created', 'message.updated')
  then
    raise exception 'Invalid MAGNIBOX APPEND outbox scope' using errcode = '23514';
  end if;

  select f.* into v_folder
  from public.magnibox_imap_folder_state f
  where f.id = new.folder_state_id
    and f.organization_id = new.organization_id;

  if not found
    or v_folder.namespace <> 'internal'
    or v_folder.mailbox_id <> new.target_mailbox_id
    or v_folder.uidvalidity <> new.uidvalidity
  then
    raise exception 'Invalid MAGNIBOX APPEND folder scope' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.magnibox_internal_messages m
    where m.id = v_event.aggregate_id
      and m.organization_id = new.organization_id
      and new.target_mailbox_id in (m.sender_mailbox_id, m.recipient_mailbox_id)
  ) then
    raise exception 'MAGNIBOX APPEND target is not a message participant' using errcode = '23503';
  end if;

  return new;
end;
$validate_append$;

revoke all on function private.magnibox_validate_imap_append_operation()
  from public, anon, authenticated;
create trigger magnibox_imap_append_operation_scope_guard
before insert or update of organization_id, outbox_event_id, target_mailbox_id, folder_state_id, uidvalidity
on public.magnibox_imap_append_operations
for each row execute function private.magnibox_validate_imap_append_operation();

create function private.magnibox_touch_imap_append_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $touch_append$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$touch_append$;

revoke all on function private.magnibox_touch_imap_append_updated_at()
  from public, anon, authenticated;
create trigger magnibox_imap_append_operation_touch
before update on public.magnibox_imap_append_operations
for each row execute function private.magnibox_touch_imap_append_updated_at();

alter table public.magnibox_imap_append_operations enable row level security;
revoke all on public.magnibox_imap_append_operations from public, anon, authenticated;
grant select, insert, update, delete on public.magnibox_imap_append_operations to service_role;

-- Create once per (event, mailbox, folder). A concurrent worker receives the
-- same persisted marker; it cannot mint a second marker for the same operation.
create function public.magnibox_get_or_create_imap_append_operation(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_lease_token uuid,
  p_target_mailbox_id uuid,
  p_folder_state_id uuid
) returns table (
  operation_id uuid,
  marker text,
  operation_state text,
  uidvalidity text,
  imap_uid text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $get_append$
declare
  v_event public.magnibox_sync_outbox%rowtype;
  v_folder public.magnibox_imap_folder_state%rowtype;
  v_operation public.magnibox_imap_append_operations%rowtype;
begin
  select o.* into v_event
  from public.magnibox_sync_outbox o
  where o.id = p_outbox_event_id
    and o.organization_id = p_organization_id
  for update;

  if p_lease_token is null or not found or v_event.status <> 'processing' or v_event.lease_token <> p_lease_token then
    raise exception 'MAGNIBOX outbox lease is not current' using errcode = '40001';
  end if;
  if v_event.aggregate_type <> 'internal_message'
    or v_event.event_type not in ('message.created', 'message.updated') then
    raise exception 'Unsupported MAGNIBOX APPEND event' using errcode = '22023';
  end if;

  select f.* into v_folder
  from public.magnibox_imap_folder_state f
  where f.id = p_folder_state_id
    and f.organization_id = p_organization_id
    and f.mailbox_id = p_target_mailbox_id
    and f.namespace = 'internal'
  for share;

  if not found then
    raise exception 'MAGNIBOX APPEND folder/mailbox scope mismatch' using errcode = '23503';
  end if;

  -- Recheck the pilot mailbox policy at the persistence boundary, not only
  -- in the earlier resolver: active, readable, individually owned, unshared.
  if not exists (
    select 1
    from public.magnibox_internal_mailboxes b
    where b.id = p_target_mailbox_id
      and b.organization_id = p_organization_id
      and b.is_active = true
      and b.can_read = true
      and b.owner_user_id is not null
  ) or exists (
    select 1
    from public.magnibox_internal_mailbox_grants g
    where g.organization_id = p_organization_id
      and g.mailbox_id = p_target_mailbox_id
      and g.is_active = true
  ) then
    raise exception 'MAGNIBOX APPEND target mailbox is not eligible' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.magnibox_internal_messages m
    where m.id = v_event.aggregate_id
      and m.organization_id = p_organization_id
      and p_target_mailbox_id in (m.sender_mailbox_id, m.recipient_mailbox_id)
  ) then
    raise exception 'MAGNIBOX APPEND target is not a message participant' using errcode = '23503';
  end if;

  insert into public.magnibox_imap_append_operations(
    organization_id, outbox_event_id, target_mailbox_id, folder_state_id, uidvalidity
  ) values (
    p_organization_id, p_outbox_event_id, p_target_mailbox_id, p_folder_state_id, v_folder.uidvalidity
  )
  on conflict (organization_id, outbox_event_id, target_mailbox_id, folder_state_id) do nothing;

  select a.* into v_operation
  from public.magnibox_imap_append_operations a
  where a.organization_id = p_organization_id
    and a.outbox_event_id = p_outbox_event_id
    and a.target_mailbox_id = p_target_mailbox_id
    and a.folder_state_id = p_folder_state_id
  for update;

  if v_operation.uidvalidity <> v_folder.uidvalidity then
    raise exception 'MAGNIBOX APPEND operation requires UIDVALIDITY reconciliation' using errcode = '40001';
  end if;

  return query select v_operation.id, v_operation.marker, v_operation.state,
    v_operation.uidvalidity::text, v_operation.imap_uid::text;
end;
$get_append$;

-- Mark the irreversible network-write boundary before sending APPEND.
-- Repeated calls never reset append_started/ambiguous back to ready.
create function public.magnibox_mark_imap_append_started(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_lease_token uuid,
  p_operation_id uuid
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $start_append$
declare
  v_event public.magnibox_sync_outbox%rowtype;
  v_operation public.magnibox_imap_append_operations%rowtype;
  v_folder_uidvalidity bigint;
begin
  select o.* into v_event from public.magnibox_sync_outbox o
  where o.id=p_outbox_event_id and o.organization_id=p_organization_id for update;
  if p_lease_token is null or not found or v_event.status <> 'processing' or v_event.lease_token <> p_lease_token then
    raise exception 'MAGNIBOX outbox lease is not current' using errcode='40001';
  end if;

  select a.* into v_operation from public.magnibox_imap_append_operations a
  where a.id=p_operation_id and a.organization_id=p_organization_id
    and a.outbox_event_id=p_outbox_event_id for update;
  if not found then raise exception 'MAGNIBOX APPEND operation not found' using errcode='P0002'; end if;

  select f.uidvalidity into v_folder_uidvalidity from public.magnibox_imap_folder_state f
  where f.id=v_operation.folder_state_id and f.organization_id=p_organization_id for share;
  if not found or v_folder_uidvalidity <> v_operation.uidvalidity then
    raise exception 'MAGNIBOX APPEND UIDVALIDITY changed; reconcile first' using errcode='40001';
  end if;

  if v_operation.state='ready' then
    update public.magnibox_imap_append_operations a
    set state='append_started', attempts=a.attempts+1,
        append_started_at=pg_catalog.clock_timestamp()
    where a.id=v_operation.id;
    return 'append_started';
  end if;
  return v_operation.state;
end;
$start_append$;

create function public.magnibox_mark_imap_append_ambiguous(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_lease_token uuid,
  p_operation_id uuid
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $ambiguous_append$
declare
  v_event public.magnibox_sync_outbox%rowtype;
  v_operation public.magnibox_imap_append_operations%rowtype;
begin
  select o.* into v_event from public.magnibox_sync_outbox o
  where o.id=p_outbox_event_id and o.organization_id=p_organization_id for update;
  if p_lease_token is null or not found or v_event.status <> 'processing' or v_event.lease_token <> p_lease_token then
    raise exception 'MAGNIBOX outbox lease is not current' using errcode='40001';
  end if;

  select a.* into v_operation from public.magnibox_imap_append_operations a
  where a.id=p_operation_id and a.organization_id=p_organization_id
    and a.outbox_event_id=p_outbox_event_id for update;
  if not found then raise exception 'MAGNIBOX APPEND operation not found' using errcode='P0002'; end if;

  if v_operation.state='append_started' then
    update public.magnibox_imap_append_operations a
    set state='ambiguous'
    where a.id=v_operation.id;
    return 'ambiguous';
  end if;
  if v_operation.state in ('ambiguous','confirmed') then return v_operation.state; end if;
  raise exception 'MAGNIBOX APPEND cannot become ambiguous before it starts' using errcode='23514';
end;
$ambiguous_append$;

-- Call only after one exact marker match or a server-confirmed APPENDUID.
-- The folder epoch is checked again under lock before persisting the UID.
create function public.magnibox_confirm_imap_append(
  p_organization_id uuid,
  p_outbox_event_id uuid,
  p_lease_token uuid,
  p_operation_id uuid,
  p_uidvalidity bigint,
  p_imap_uid bigint
) returns table (operation_id uuid, marker text, operation_state text, uidvalidity text, imap_uid text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $confirm_append$
declare
  v_event public.magnibox_sync_outbox%rowtype;
  v_operation public.magnibox_imap_append_operations%rowtype;
  v_folder_uidvalidity bigint;
begin
  if p_uidvalidity is null or p_uidvalidity <= 0 or p_imap_uid is null or p_imap_uid <= 0 then
    raise exception 'Invalid MAGNIBOX APPEND UID confirmation' using errcode='22023';
  end if;

  select o.* into v_event from public.magnibox_sync_outbox o
  where o.id=p_outbox_event_id and o.organization_id=p_organization_id for update;
  if p_lease_token is null or not found or v_event.status <> 'processing' or v_event.lease_token <> p_lease_token then
    raise exception 'MAGNIBOX outbox lease is not current' using errcode='40001';
  end if;

  select a.* into v_operation from public.magnibox_imap_append_operations a
  where a.id=p_operation_id and a.organization_id=p_organization_id
    and a.outbox_event_id=p_outbox_event_id for update;
  if not found then raise exception 'MAGNIBOX APPEND operation not found' using errcode='P0002'; end if;

  select f.uidvalidity into v_folder_uidvalidity from public.magnibox_imap_folder_state f
  where f.id=v_operation.folder_state_id and f.organization_id=p_organization_id for update;
  if not found or v_folder_uidvalidity <> p_uidvalidity
    or v_operation.uidvalidity <> p_uidvalidity then
    raise exception 'MAGNIBOX APPEND confirmation requires UIDVALIDITY reconciliation' using errcode='40001';
  end if;

  if v_operation.state='confirmed' then
    if v_operation.imap_uid <> p_imap_uid then
      raise exception 'Conflicting MAGNIBOX APPEND UID confirmation' using errcode='23505';
    end if;
    return query select v_operation.id, v_operation.marker, v_operation.state,
      v_operation.uidvalidity::text, v_operation.imap_uid::text;
    return;
  end if;

  if v_operation.state not in ('ready','append_started','ambiguous') then
    raise exception 'Invalid MAGNIBOX APPEND confirmation state' using errcode='23514';
  end if;

  update public.magnibox_imap_append_operations a
  set state='confirmed', imap_uid=p_imap_uid,
      append_started_at=coalesce(a.append_started_at, pg_catalog.clock_timestamp()),
      confirmed_at=pg_catalog.clock_timestamp()
  where a.id=v_operation.id
  returning a.id,a.marker,a.state,a.uidvalidity::text,a.imap_uid::text
  into operation_id,marker,operation_state,uidvalidity,imap_uid;
  return next;
end;
$confirm_append$;

revoke all on function public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.magnibox_mark_imap_append_started(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.magnibox_mark_imap_append_ambiguous(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.magnibox_get_or_create_imap_append_operation(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.magnibox_mark_imap_append_started(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.magnibox_mark_imap_append_ambiguous(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.magnibox_confirm_imap_append(uuid,uuid,uuid,uuid,bigint,bigint) to service_role;

commit;
