-- MAGNIBOX IMAP projection metadata and transactional synchronization outbox.
-- Supabase remains canonical; IMAP is a projection. No message body or attachment
-- bytes are copied into the outbox. Worker RPCs are executable only by service_role.

begin;

create table public.magnibox_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aggregate_type text not null
    check (aggregate_type in ('internal_message', 'external_message')),
  aggregate_id uuid not null,
  event_type text not null
    check (event_type in (
      'message.created', 'message.updated', 'message.flags_changed',
      'message.moved', 'message.deleted', 'message.label_added',
      'message.label_removed'
    )),
  dedupe_key text not null unique,
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
    or (status <> 'processing' and locked_at is null and locked_by is null and lease_token is null)
  )
);

create index magnibox_sync_outbox_ready_idx
  on public.magnibox_sync_outbox (available_at, created_at, id)
  where status in ('pending', 'processing');
create index magnibox_sync_outbox_aggregate_idx
  on public.magnibox_sync_outbox (organization_id, aggregate_type, aggregate_id, created_at);

create table public.magnibox_imap_folder_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  namespace text not null check (namespace in ('internal', 'internet')),
  identity_id uuid,
  folder_key text not null check (char_length(btrim(folder_key)) between 1 and 160),
  imap_folder_name text not null check (char_length(btrim(imap_folder_name)) between 1 and 255),
  uidvalidity bigint not null check (uidvalidity > 0),
  uidnext bigint check (uidnext is null or uidnext > 0),
  highest_modseq bigint check (highest_modseq is null or highest_modseq >= 0),
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magnibox_imap_folder_mailbox_org_fk
    foreign key (mailbox_id, organization_id)
    references public.magnibox_internal_mailboxes(id, organization_id) on delete restrict,
  constraint magnibox_imap_folder_identity_org_fk
    foreign key (identity_id, organization_id)
    references public.orbit_public_identities(id, organization_id) on delete restrict,
  constraint magnibox_imap_folder_namespace_identity_ck check (
    (namespace = 'internal' and identity_id is null)
    or (namespace = 'internet' and identity_id is not null)
  ),
  unique (id, organization_id)
);

create unique index magnibox_imap_internal_folder_key_uidx
  on public.magnibox_imap_folder_state(mailbox_id, folder_key)
  where namespace = 'internal';
create unique index magnibox_imap_internet_folder_key_uidx
  on public.magnibox_imap_folder_state(identity_id, folder_key)
  where namespace = 'internet';
create index magnibox_imap_folder_reconcile_idx
  on public.magnibox_imap_folder_state(organization_id, namespace, last_reconciled_at);

create function private.magnibox_validate_imap_folder_identity()
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
    raise exception 'MAGNIBOX IMAP identity/mailbox mismatch' using errcode = '23503';
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
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null
    check (source_type in ('internal_message', 'external_message')),
  source_message_id uuid not null,
  folder_state_id uuid not null,
  uidvalidity bigint not null check (uidvalidity > 0),
  imap_uid bigint check (imap_uid is null or imap_uid > 0),
  imap_modseq bigint check (imap_modseq is null or imap_modseq >= 0),
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
    references public.magnibox_imap_folder_state(id, organization_id) on delete restrict,
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
create index magnibox_imap_map_source_idx
  on public.magnibox_imap_message_map(organization_id, source_type, source_message_id);

-- Validate polymorphic source references and mailbox/identity membership.
-- Tombstones remain valid after the canonical source row is deleted.
create function private.magnibox_validate_imap_message_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $validate_map$
begin
  if tg_op = 'UPDATE' then
    if (old.source_type, old.source_message_id, old.folder_state_id, old.organization_id)
      is not distinct from
        (new.source_type, new.source_message_id, new.folder_state_id, new.organization_id) then
      return new;
    end if;
  end if;

  if new.source_type = 'internal_message' then
    if not exists (
      select 1
      from public.magnibox_internal_messages m
      join public.magnibox_imap_folder_state f
        on f.id = new.folder_state_id and f.organization_id = new.organization_id
      where m.id = new.source_message_id
        and m.organization_id = new.organization_id
        and f.namespace = 'internal'
        and f.identity_id is null
        and f.mailbox_id in (m.sender_mailbox_id, m.recipient_mailbox_id)
    ) then
      raise exception 'MAGNIBOX internal message/folder mapping mismatch' using errcode = '23503';
    end if;
  elsif new.source_type = 'external_message' then
    if not exists (
      select 1
      from public.orbit_external_messages m
      join public.magnibox_imap_folder_state f
        on f.id = new.folder_state_id
       and f.organization_id = new.organization_id
       and f.identity_id = m.identity_id
      where m.id = new.source_message_id
        and m.organization_id = new.organization_id
        and f.namespace = 'internet'
    ) then
      raise exception 'MAGNIBOX external message/folder mapping mismatch' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$validate_map$;

revoke all on function private.magnibox_validate_imap_message_map()
  from public, anon, authenticated;
create trigger magnibox_imap_message_map_source_guard
before insert or update of source_type, source_message_id, folder_state_id, organization_id
on public.magnibox_imap_message_map
for each row execute function private.magnibox_validate_imap_message_map();

create function private.magnibox_touch_imap_sync_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $touch$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$touch$;

revoke all on function private.magnibox_touch_imap_sync_updated_at()
  from public, anon, authenticated;
create trigger magnibox_imap_folder_state_touch
before update on public.magnibox_imap_folder_state
for each row execute function private.magnibox_touch_imap_sync_updated_at();
create trigger magnibox_imap_message_map_touch
before update on public.magnibox_imap_message_map
for each row execute function private.magnibox_touch_imap_sync_updated_at();

alter table public.magnibox_sync_outbox enable row level security;
alter table public.magnibox_imap_folder_state enable row level security;
alter table public.magnibox_imap_message_map enable row level security;

revoke all on public.magnibox_sync_outbox from public, anon, authenticated;
revoke all on public.magnibox_imap_folder_state from public, anon, authenticated;
revoke all on public.magnibox_imap_message_map from public, anon, authenticated;
grant select, insert, update, delete on public.magnibox_sync_outbox to service_role;
grant select, insert, update, delete on public.magnibox_imap_folder_state to service_role;
grant select, insert, update, delete on public.magnibox_imap_message_map to service_role;

-- Claim/reclaim uses SKIP LOCKED and an expiring lease. A new token fences
-- workers whose lease expired while they were still performing IMAP I/O.
create function public.magnibox_claim_sync_events(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
) returns setof public.magnibox_sync_outbox
language plpgsql
security definer
set search_path = ''
as $claim$
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 then
    raise exception 'Invalid MAGNIBOX worker ID' using errcode = '22023';
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
      lease_token = pg_catalog.gen_random_uuid(),
      available_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 120), 900)))
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$claim$;

create function public.magnibox_complete_sync_event(
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

create function public.magnibox_fail_sync_event(
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
  v_error text;
begin
  -- Remove common credential fragments before persisting worker diagnostics.
  v_error := left(
    pg_catalog.regexp_replace(
      coalesce(p_error, 'Unknown sync error'),
      '(?i)(password|token|secret|authorization)[[:space:]]*[:=][[:space:]]*[^ ,;]+',
      '\1=[redacted]',
      'g'
    ),
    2000
  );

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
      last_error = v_error,
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

-- The outbox insert is part of the source transaction. Only canonical content
-- changes and creation/deletion of non-draft messages are projected; transport
-- status churn and personal read/label state do not create IMAP feedback loops.
create function private.magnibox_enqueue_message_sync_event()
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
  v_fingerprint text;
  v_aggregate_type text;
  v_dedupe_key text;
begin
  if tg_table_name = 'magnibox_internal_messages' then
    v_aggregate_type := 'internal_message';
    if tg_op = 'DELETE' then
      v_row := pg_catalog.to_jsonb(old);
      v_org := old.organization_id;
      v_message_id := old.id;
      v_event := 'message.deleted';
      v_payload := pg_catalog.jsonb_build_object(
        'message_id', old.id,
        'sender_mailbox_id', old.sender_mailbox_id,
        'recipient_mailbox_id', old.recipient_mailbox_id
      );
      v_fingerprint := pg_catalog.md5(concat_ws(E'\x1f', old.subject, old.body_text));
    else
      v_row := pg_catalog.to_jsonb(new);
      v_org := new.organization_id;
      v_message_id := new.id;
      v_event := 'message.created';
      v_payload := pg_catalog.jsonb_build_object(
        'message_id', new.id,
        'sender_mailbox_id', new.sender_mailbox_id,
        'recipient_mailbox_id', new.recipient_mailbox_id
      );
      v_fingerprint := pg_catalog.md5(concat_ws(E'\x1f', new.subject, new.body_text));
    end if;
  elsif tg_table_name = 'orbit_external_messages' then
    v_aggregate_type := 'external_message';
    if tg_op = 'DELETE' then
      if old.status = 'draft' then return old; end if;
      v_row := pg_catalog.to_jsonb(old);
      v_org := old.organization_id;
      v_message_id := old.id;
      v_event := 'message.deleted';
      v_payload := pg_catalog.jsonb_build_object(
        'message_id', old.id,
        'identity_id', old.identity_id
      );
      v_fingerprint := pg_catalog.md5(concat_ws(E'\x1f', old.subject, old.body_text));
    elsif tg_op = 'INSERT' then
      if new.status = 'draft' then return new; end if;
      v_row := pg_catalog.to_jsonb(new);
      v_org := new.organization_id;
      v_message_id := new.id;
      v_event := 'message.created';
      v_payload := pg_catalog.jsonb_build_object(
        'message_id', new.id,
        'identity_id', new.identity_id
      );
      v_fingerprint := pg_catalog.md5(concat_ws(E'\x1f', new.from_email, new.to_emails::text, new.subject, new.body_text));
    else
      if old.status = 'draft' and new.status <> 'draft' then
        v_event := 'message.created';
      elsif old.identity_id is distinct from new.identity_id
        or old.from_email is distinct from new.from_email
        or old.to_emails is distinct from new.to_emails
        or old.subject is distinct from new.subject
        or old.body_text is distinct from new.body_text then
        v_event := 'message.updated';
      else
        return new;
      end if;
      v_row := pg_catalog.to_jsonb(new);
      v_org := new.organization_id;
      v_message_id := new.id;
      v_payload := pg_catalog.jsonb_build_object(
        'message_id', new.id,
        'identity_id', new.identity_id
      );
      v_fingerprint := pg_catalog.md5(concat_ws(E'\x1f', new.from_email, new.to_emails::text, new.subject, new.body_text));
    end if;
  else
    raise exception 'Unsupported MAGNIBOX sync source table: %', tg_table_name;
  end if;

  v_dedupe_key := v_aggregate_type || ':' || v_message_id::text || ':'
    || pg_catalog.txid_current()::text || ':' || v_event || ':' || v_fingerprint;

  insert into public.magnibox_sync_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload
  ) values (
    v_org, v_aggregate_type, v_message_id, v_event, v_dedupe_key, v_payload
  ) on conflict (dedupe_key) do nothing;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$enqueue$;

revoke all on function private.magnibox_enqueue_message_sync_event()
  from public, anon, authenticated;
create trigger magnibox_internal_message_sync_outbox
after insert or delete on public.magnibox_internal_messages
for each row execute function private.magnibox_enqueue_message_sync_event();
create trigger magnibox_external_message_sync_outbox
after insert or delete or update of direction, status, identity_id, from_email, to_emails, subject, body_text
on public.orbit_external_messages
for each row execute function private.magnibox_enqueue_message_sync_event();

commit;
