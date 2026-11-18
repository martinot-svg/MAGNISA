-- MAGNIBOX IMAP sync engine — proposal only.
-- DO NOT APPLY DIRECTLY TO PRODUCTION.
-- This is deliberately stored under infra/, not supabase/migrations/, until
-- production migration history and prerequisite migrations are reconciled.
--
-- Prerequisites:
--   public.mgmail_internal_mailboxes (id, organization_id)
--   public.mgmail_internal_messages
--   public.orbit_public_identities (id, organization_id, mailbox_id)
--   public.orbit_external_messages
--
-- Design: Supabase remains canonical. IMAP is a projection. Tombstones live on
-- the old message↔folder mapping row, so they retain the old UID generation.

begin;

create table public.magnibox_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  aggregate_type text not null
    check (aggregate_type in ('internal_message', 'external_message')),
  aggregate_id uuid not null,
  event_type text not null
    check (event_type in (
      'message.created', 'message.updated', 'message.flags_changed',
      'message.moved', 'message.deleted', 'message.label_added',
      'message.label_removed'
    )),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint magnibox_sync_outbox_lease_consistency check (
    (status = 'processing' and locked_at is not null and locked_by is not null and lease_token is not null)
    or
    (status <> 'processing' and locked_at is null and locked_by is null and lease_token is null)
  )
);

create index magnibox_sync_outbox_ready_idx
  on public.magnibox_sync_outbox (available_at, created_at)
  where status in ('pending', 'processing');

create index magnibox_sync_outbox_aggregate_idx
  on public.magnibox_sync_outbox (organization_id, aggregate_type, aggregate_id, created_at);

create table public.magnibox_imap_folder_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  mailbox_id uuid not null,
  namespace text not null check (namespace in ('internal', 'internet')),
  identity_id uuid,
  folder_key text not null,
  imap_folder_name text not null,
  uidvalidity bigint not null check (uidvalidity > 0),
  uidnext bigint check (uidnext is null or uidnext > 0),
  highest_modseq numeric(20,0) check (highest_modseq is null or highest_modseq >= 0),
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_imap_folder_mailbox_org_fk
    foreign key (mailbox_id, organization_id)
    references public.mgmail_internal_mailboxes(id, organization_id)
    on delete restrict,
  constraint magnibox_imap_folder_identity_org_fk
    foreign key (identity_id, organization_id)
    references public.orbit_public_identities(id, organization_id)
    on delete restrict,
  constraint magnibox_imap_folder_namespace_identity_ck check (
    (namespace = 'internal' and identity_id is null)
    or (namespace = 'internet' and identity_id is not null)
  ),
  unique (mailbox_id, namespace, folder_key),
  unique (id, organization_id)
);

-- Enforce that an Internet identity is projected only into its own
-- underlying MAGNIBOX mailbox (same tenant + mailbox binding).
create or replace function private.magnibox_validate_imap_folder_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $validate_identity$
begin
  if new.namespace = 'internet' and not exists (
    select 1
    from public.orbit_public_identities i
    where i.id = new.identity_id
      and i.organization_id = new.organization_id
      and i.mailbox_id = new.mailbox_id
  ) then
    raise exception 'MAGNIBOX IMAP identity/mailbox mismatch'
      using errcode = '23503';
  end if;
  return new;
end;
$validate_identity$;

revoke all on function private.magnibox_validate_imap_folder_identity()
  from public, anon, authenticated;

create trigger magnibox_imap_folder_identity_guard
before insert or update of namespace, identity_id, mailbox_id, organization_id
on public.magnibox_imap_folder_state
for each row execute function private.magnibox_validate_imap_folder_identity();

create table public.magnibox_imap_message_map (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_type text not null
    check (source_type in ('internal_message', 'external_message')),
  source_message_id uuid not null,
  folder_state_id uuid not null,
  uidvalidity bigint not null check (uidvalidity > 0),
  imap_uid bigint check (imap_uid is null or imap_uid > 0),
  imap_modseq numeric(20,0) check (imap_modseq is null or imap_modseq >= 0),
  imap_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(imap_flags) = 'array'),
  sync_version bigint not null default 1 check (sync_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  delete_event_id uuid,
  delete_confirmed_at timestamptz,
  constraint magnibox_imap_map_folder_org_fk
    foreign key (folder_state_id, organization_id)
    references public.magnibox_imap_folder_state(id, organization_id)
    on delete restrict,
  constraint magnibox_imap_map_tombstone_ck check (
    (deleted_at is null and delete_event_id is null and delete_confirmed_at is null)
    or (deleted_at is not null and delete_event_id is not null)
  )
);

create unique index magnibox_imap_map_uid_uidvalidity_uidx
  on public.magnibox_imap_message_map(folder_state_id, uidvalidity, imap_uid)
  where imap_uid is not null;

create unique index magnibox_imap_map_active_source_folder_uidx
  on public.magnibox_imap_message_map(source_type, source_message_id, folder_state_id)
  where deleted_at is null;

create index magnibox_imap_map_reconcile_idx
  on public.magnibox_imap_message_map(folder_state_id, uidvalidity, imap_uid)
  where deleted_at is null;

alter table public.magnibox_sync_outbox enable row level security;
alter table public.magnibox_imap_folder_state enable row level security;
alter table public.magnibox_imap_message_map enable row level security;

revoke all on public.magnibox_sync_outbox from public, anon, authenticated;
revoke all on public.magnibox_imap_folder_state from public, anon, authenticated;
revoke all on public.magnibox_imap_message_map from public, anon, authenticated;
grant select, insert, update, delete on public.magnibox_sync_outbox to service_role;
grant select, insert, update, delete on public.magnibox_imap_folder_state to service_role;
grant select, insert, update, delete on public.magnibox_imap_message_map to service_role;

-- A worker lease is fenced by lease_token. An expired worker cannot acknowledge
-- a task after another worker has reclaimed it.
create or replace function public.magnibox_claim_sync_events(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns setof public.magnibox_sync_outbox
language plpgsql
security definer
set search_path = ''
as $claim$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_worker_id is null or length(btrim(p_worker_id)) not between 1 and 120 then
    raise exception 'MAGNIBOX worker access denied' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select o.id
    from public.magnibox_sync_outbox o
    where o.status in ('pending', 'processing')
      and o.available_at <= pg_catalog.clock_timestamp()
    order by o.available_at, o.created_at, o.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.magnibox_sync_outbox o
  set status = 'processing',
      attempts = o.attempts + 1,
      locked_at = pg_catalog.clock_timestamp(),
      locked_by = p_worker_id,
      lease_token = gen_random_uuid(),
      available_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 120), 900)))
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$claim$;

create or replace function public.magnibox_complete_sync_event(
  p_event_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $complete$
declare
  v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'MAGNIBOX worker access denied' using errcode = '42501';
  end if;

  update public.magnibox_sync_outbox
  set status = 'delivered',
      processed_at = pg_catalog.clock_timestamp(),
      locked_at = null,
      locked_by = null,
      lease_token = null,
      last_error = null
  where id = p_event_id
    and status = 'processing'
    and lease_token = p_lease_token;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$complete$;

create or replace function public.magnibox_fail_sync_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true,
  p_retry_after_seconds integer default 60,
  p_max_attempts integer default 12
) returns text
language plpgsql
security definer
set search_path = ''
as $fail$
declare
  v_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'MAGNIBOX worker access denied' using errcode = '42501';
  end if;

  update public.magnibox_sync_outbox
  set status = case
        when not coalesce(p_retryable, false)
          or attempts >= greatest(1, least(coalesce(p_max_attempts, 12), 50))
        then 'dead'
        else 'pending'
      end,
      available_at = case
        when not coalesce(p_retryable, false)
          or attempts >= greatest(1, least(coalesce(p_max_attempts, 12), 50))
        then available_at
        else pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400)))
      end,
      last_error = left(coalesce(p_error, 'Unknown sync error'), 2000),
      processed_at = case
        when not coalesce(p_retryable, false)
          or attempts >= greatest(1, least(coalesce(p_max_attempts, 12), 50))
        then pg_catalog.clock_timestamp()
        else null
      end,
      locked_at = null,
      locked_by = null,
      lease_token = null
  where id = p_event_id
    and status = 'processing'
    and lease_token = p_lease_token
  returning status into v_status;

  return v_status;
end;
$fail$;

revoke all on function public.magnibox_claim_sync_events(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.magnibox_complete_sync_event(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.magnibox_fail_sync_event(uuid, uuid, text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.magnibox_claim_sync_events(text, integer, integer) to service_role;
grant execute on function public.magnibox_complete_sync_event(uuid, uuid) to service_role;
grant execute on function public.magnibox_fail_sync_event(uuid, uuid, text, boolean, integer, integer) to service_role;

-- Trigger bridge: insert an event in the same transaction as the source write.
-- The payload contains IDs only. The worker reloads content from the canonical
-- source table; no message body or attachment bytes are copied into the queue.
create or replace function private.magnibox_enqueue_message_sync_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $enqueue$
declare
  v_row jsonb;
  v_org uuid;
  v_message_id uuid;
  v_event text;
  v_payload jsonb;
  v_aggregate_type text;
begin
  v_row := case when tg_op = 'DELETE' then pg_catalog.to_jsonb(old) else pg_catalog.to_jsonb(new) end;

  if tg_table_name = 'mgmail_internal_messages' then
    v_aggregate_type := 'internal_message';
    v_org := (v_row ->> 'organization_id')::uuid;
    v_message_id := (v_row ->> 'id')::uuid;
    if tg_op = 'INSERT' then
      v_event := 'message.created';
    elsif tg_op = 'DELETE' then
      v_event := 'message.deleted';
    elsif (old.read_at is distinct from new.read_at) then
      v_event := 'message.flags_changed';
    else
      v_event := 'message.updated';
    end if;
    v_payload := pg_catalog.jsonb_build_object(
      'message_id', v_message_id,
      'sender_mailbox_id', v_row ->> 'sender_mailbox_id',
      'recipient_mailbox_id', v_row ->> 'recipient_mailbox_id'
    );
  elsif tg_table_name = 'orbit_external_messages' then
    v_aggregate_type := 'external_message';
    v_org := (v_row ->> 'organization_id')::uuid;
    v_message_id := (v_row ->> 'id')::uuid;
    if tg_op = 'INSERT' then
      v_event := 'message.created';
    elsif tg_op = 'DELETE' then
      v_event := 'message.deleted';
    elsif old.status is distinct from new.status then
      v_event := 'message.flags_changed';
    else
      v_event := 'message.updated';
    end if;
    v_payload := pg_catalog.jsonb_build_object(
      'message_id', v_message_id,
      'identity_id', v_row ->> 'identity_id'
    );
  else
    raise exception 'Unsupported MAGNIBOX sync source table: %', tg_table_name;
  end if;

  insert into public.magnibox_sync_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    v_org, v_aggregate_type, v_message_id, v_event, v_payload
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$enqueue$;

revoke all on function private.magnibox_enqueue_message_sync_event()
  from public, anon, authenticated;

create trigger magnibox_internal_message_sync_outbox
after insert or update or delete on public.mgmail_internal_messages
for each row execute function private.magnibox_enqueue_message_sync_event();

create trigger magnibox_external_message_sync_outbox
after insert or update or delete on public.orbit_external_messages
for each row execute function private.magnibox_enqueue_message_sync_event();

commit;

-- Intentionally not included in this proposal:
-- * mgmail_internal_message_reads: per-user read state needs an explicit IMAP
--   mailbox/identity policy before it can be projected to shared mailbox flags.
-- * mgmail_internal_message_folders: personal labels are not canonical IMAP
--   folders; do not misrepresent label changes as physical message moves.
-- * a Dovecot filesystem/Maildir writer: the worker must use IMAP over TLS.
-- * production migration-history repair or deployment.
