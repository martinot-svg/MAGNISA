-- Atomic server-only operations for durable MAGNIBOX IMAP UID mappings.
begin;

create or replace function public.magnibox_get_imap_message_mapping(
  p_organization_id uuid,
  p_source_type text,
  p_source_message_id uuid,
  p_folder_state_id uuid
) returns table (
  mapping_id uuid,
  organization_id uuid,
  source_type text,
  source_message_id uuid,
  folder_state_id uuid,
  uidvalidity bigint,
  imap_uid bigint,
  imap_modseq bigint,
  imap_flags jsonb,
  sync_version bigint,
  deleted_at timestamptz,
  delete_event_id uuid,
  delete_confirmed_at timestamptz
)
language sql stable security definer
set search_path = pg_catalog, public
as $get_mapping$
  select m.id,m.organization_id,m.source_type,m.source_message_id,
    m.folder_state_id,m.uidvalidity,m.imap_uid,m.imap_modseq,m.imap_flags,
    m.sync_version,m.deleted_at,m.delete_event_id,m.delete_confirmed_at
  from public.magnibox_imap_message_map m
  where m.organization_id=p_organization_id
    and m.source_type=p_source_type
    and m.source_message_id=p_source_message_id
    and m.folder_state_id=p_folder_state_id
  limit 1;
$get_mapping$;

-- Persist only a UID confirmed by the IMAP server. A changed UIDVALIDITY
-- requires the caller to explicitly compare-and-swap the previous epoch after
-- a completed server reconciliation; the RPC never silently overwrites it.
create or replace function public.magnibox_record_imap_message_uid(
  p_organization_id uuid,
  p_source_type text,
  p_source_message_id uuid,
  p_folder_state_id uuid,
  p_uidvalidity bigint,
  p_imap_uid bigint,
  p_expected_previous_uidvalidity bigint default null,
  p_imap_modseq bigint default null,
  p_imap_flags jsonb default '[]'::jsonb
) returns table (mapping_id uuid, sync_version bigint, result text)
language plpgsql security definer
set search_path = pg_catalog, public
as $record_uid$
declare
  v_folder_uidvalidity bigint;
  v_mapping public.magnibox_imap_message_map%rowtype;
begin
  if p_source_type not in ('internal_message','external_message')
    or p_uidvalidity is null or p_uidvalidity <= 0
    or p_imap_uid is null or p_imap_uid <= 0
    or (p_expected_previous_uidvalidity is not null and p_expected_previous_uidvalidity <= 0)
    or (p_imap_modseq is not null and p_imap_modseq < 0)
    or jsonb_typeof(coalesce(p_imap_flags,'[]'::jsonb)) <> 'array' then
    raise exception 'Invalid MAGNIBOX IMAP mapping input' using errcode='22023';
  end if;

  select f.uidvalidity into v_folder_uidvalidity
  from public.magnibox_imap_folder_state f
  where f.id=p_folder_state_id and f.organization_id=p_organization_id
  for update;

  if not found then
    raise exception 'MAGNIBOX IMAP folder state not found' using errcode='P0002';
  end if;
  if v_folder_uidvalidity <> p_uidvalidity then
    raise exception 'MAGNIBOX IMAP UIDVALIDITY changed during mapping' using errcode='40001';
  end if;

  select m.* into v_mapping
  from public.magnibox_imap_message_map m
  where m.organization_id=p_organization_id
    and m.source_type=p_source_type
    and m.source_message_id=p_source_message_id
    and m.folder_state_id=p_folder_state_id
  for update;

  if found then
    if v_mapping.deleted_at is not null then
      raise exception 'Cannot overwrite a tombstoned MAGNIBOX IMAP mapping' using errcode='23514';
    end if;

    if v_mapping.uidvalidity=p_uidvalidity then
      if v_mapping.imap_uid=p_imap_uid then
        return query select v_mapping.id,v_mapping.sync_version,'already_recorded'::text;
        return;
      end if;
      raise exception 'Conflicting UID for existing MAGNIBOX IMAP mapping' using errcode='23505';
    end if;

    if p_expected_previous_uidvalidity is null
      or v_mapping.uidvalidity <> p_expected_previous_uidvalidity then
      raise exception 'UIDVALIDITY reconciliation compare-and-swap required' using errcode='40001';
    end if;

    update public.magnibox_imap_message_map m
    set uidvalidity=p_uidvalidity, imap_uid=p_imap_uid,
        imap_modseq=p_imap_modseq,
        imap_flags=coalesce(p_imap_flags,'[]'::jsonb),
        sync_version=m.sync_version+1
    where m.id=v_mapping.id
    returning m.id,m.sync_version into mapping_id,sync_version;
    result := 'reconciled';
    return next;
    return;
  end if;

  insert into public.magnibox_imap_message_map(
    organization_id,source_type,source_message_id,folder_state_id,
    uidvalidity,imap_uid,imap_modseq,imap_flags
  ) values (
    p_organization_id,p_source_type,p_source_message_id,p_folder_state_id,
    p_uidvalidity,p_imap_uid,p_imap_modseq,coalesce(p_imap_flags,'[]'::jsonb)
  )
  returning id,magnibox_imap_message_map.sync_version
  into mapping_id,sync_version;
  result := 'inserted';
  return next;
end;
$record_uid$;

create or replace function public.magnibox_tombstone_imap_message_mapping(
  p_organization_id uuid,
  p_source_type text,
  p_source_message_id uuid,
  p_folder_state_id uuid,
  p_delete_event_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $tombstone$
declare
  v_mapping public.magnibox_imap_message_map%rowtype;
begin
  if p_delete_event_id is null then
    raise exception 'Delete event ID is required for IMAP tombstone' using errcode='22023';
  end if;

  select m.* into v_mapping
  from public.magnibox_imap_message_map m
  where m.organization_id=p_organization_id
    and m.source_type=p_source_type
    and m.source_message_id=p_source_message_id
    and m.folder_state_id=p_folder_state_id
  for update;

  if not found then return false; end if;

  if v_mapping.deleted_at is not null then
    if v_mapping.delete_event_id=p_delete_event_id then return true; end if;
    raise exception 'Conflicting delete event for IMAP tombstone' using errcode='23505';
  end if;

  update public.magnibox_imap_message_map m
  set deleted_at=pg_catalog.clock_timestamp(),
      delete_event_id=p_delete_event_id,
      delete_confirmed_at=null
  where m.id=v_mapping.id;
  return true;
end;
$tombstone$;

revoke all on function public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb)
  from public,anon,authenticated;
revoke all on function public.magnibox_tombstone_imap_message_mapping(uuid,text,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.magnibox_get_imap_message_mapping(uuid,text,uuid,uuid) to service_role;
grant execute on function public.magnibox_record_imap_message_uid(uuid,text,uuid,uuid,bigint,bigint,bigint,bigint,jsonb) to service_role;
grant execute on function public.magnibox_tombstone_imap_message_mapping(uuid,text,uuid,uuid,uuid) to service_role;

commit;
