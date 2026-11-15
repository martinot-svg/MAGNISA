-- Atomically transition a private outgoing draft into SMTP submission.
-- A draft can only be submitted once; retries with the same request key are read-only.
create or replace function public.orbit_reserve_magnibox_draft_send(
  p_organization_id uuid,
  p_draft_id uuid,
  p_identity_id uuid,
  p_created_by uuid,
  p_request_key uuid,
  p_daily_limit integer
) returns table(message_id uuid, should_send boolean)
language plpgsql
security definer
set search_path = ''
as $magnibox_draft_send$
declare
  v_draft public.orbit_external_messages%rowtype;
  v_count bigint;
begin
  if p_organization_id is null or p_draft_id is null or p_identity_id is null
    or p_created_by is null or p_request_key is null
    or p_daily_limit is null or p_daily_limit not between 1 and 20 then
    raise exception 'Invalid MAGNIBOX draft submission' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_identity_id::text, 0)
  );

  select * into v_draft
  from public.orbit_external_messages m
  where m.id = p_draft_id
    and m.organization_id = p_organization_id
    and m.identity_id = p_identity_id
    and m.created_by = p_created_by
    and m.direction = 'outgoing'
  for update;

  if not found then
    raise exception 'MAGNIBOX draft not found or not owned by caller' using errcode = '42501';
  end if;

  if v_draft.status <> 'draft' then
    if v_draft.request_key = p_request_key
      and v_draft.status in ('sending','accepted','delivered','failed','bounced','uncertain') then
      return query select v_draft.id, false;
      return;
    end if;
    raise exception 'MAGNIBOX draft is no longer editable or has a different submission key'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.orbit_public_identities i
    where i.id = p_identity_id
      and i.organization_id = p_organization_id
      and i.email_address = v_draft.from_email
      and i.status = 'active'
      and i.provider = 'smtp'
  ) then
    raise exception 'MAGNIBOX sender identity is not active' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.orbit_external_message_attachments a
    where a.message_id = p_draft_id
      and a.organization_id = p_organization_id
      and a.scan_status <> 'available'
  ) then
    raise exception 'MAGNIBOX draft attachments are not fully scanned' using errcode = '55000';
  end if;

  select count(*) into v_count
  from public.orbit_external_messages m
  where m.organization_id = p_organization_id
    and m.identity_id = p_identity_id
    and m.direction = 'outgoing'
    and m.status <> 'draft'
    and m.created_at >= pg_catalog.now() - interval '24 hours';

  if v_count >= p_daily_limit then
    raise exception 'MAGNIBOX outbound quota exceeded' using errcode = 'P0001';
  end if;

  update public.orbit_external_messages
  set status = 'sending',
      request_key = p_request_key,
      updated_at = pg_catalog.now()
  where id = p_draft_id
    and organization_id = p_organization_id
    and status = 'draft';

  return query select p_draft_id, true;
end;
$magnibox_draft_send$;

revoke all on function public.orbit_reserve_magnibox_draft_send(uuid,uuid,uuid,uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.orbit_reserve_magnibox_draft_send(uuid,uuid,uuid,uuid,uuid,integer)
  to service_role;

-- Lock ordering prevents an attachment upload from racing the draft transition.
-- Incoming received messages keep their existing ingestion path.
create or replace function private.orbit_limit_external_message_attachments()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $orbit_attachment_limit$
declare
  current_count integer;
  current_bytes bigint;
  parent_direction text;
  parent_status text;
begin
  select direction, status into parent_direction, parent_status
  from public.orbit_external_messages
  where id = new.message_id and organization_id = new.organization_id
  for update;

  if not found then
    raise exception 'MAGNIBOX message not found';
  end if;

  if (parent_direction = 'outgoing' and parent_status <> 'draft')
    or (parent_direction = 'incoming' and parent_status <> 'received')
    or parent_direction not in ('incoming','outgoing') then
    raise exception 'MAGNIBOX attachments cannot be added after message submission';
  end if;

  if new.byte_size < 1 or new.byte_size > 31457280 then
    raise exception 'MAGNIBOX attachment file size limit exceeded';
  end if;

  select count(*), coalesce(sum(byte_size), 0)
    into current_count, current_bytes
    from public.orbit_external_message_attachments
    where message_id = new.message_id;

  if current_count >= 5 or current_bytes + new.byte_size > 157286400 then
    raise exception 'MAGNIBOX attachment limits exceeded';
  end if;
  if new.storage_path !~ ('^' || new.organization_id::text || '/' || new.message_id::text || '/[0-9a-f-]{36}$') then
    raise exception 'Invalid MAGNIBOX attachment storage path';
  end if;
  return new;
end;
$orbit_attachment_limit$;

revoke all on function private.orbit_limit_external_message_attachments()
  from public, anon, authenticated;
