-- Read-only, bounded inventory for the next phase of UIDVALIDITY recovery.
-- This deliberately does not mutate folder epochs or message mappings.
begin;

create function public.magnibox_list_imap_append_recovery(
  p_organization_id uuid,
  p_folder_state_id uuid,
  p_current_uidvalidity bigint,
  p_after_operation_id uuid default null,
  p_limit integer default 100
) returns table (
  operation_id uuid,
  outbox_event_id uuid,
  source_message_id uuid,
  marker text,
  operation_state text,
  operation_uidvalidity text,
  imap_uid text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $recovery_inventory$
begin
  if p_organization_id is null or p_folder_state_id is null
    or p_current_uidvalidity is null or p_current_uidvalidity <= 0
    or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Invalid MAGNIBOX IMAP recovery inventory parameters'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.magnibox_imap_folder_state f
    where f.id = p_folder_state_id
      and f.organization_id = p_organization_id
      and f.namespace = 'internal'
      and f.uidvalidity = p_current_uidvalidity
  ) then
    raise exception 'MAGNIBOX IMAP recovery folder epoch mismatch'
      using errcode = '23503';
  end if;

  return query
  select a.id, a.outbox_event_id, o.aggregate_id, a.marker, a.state,
    a.uidvalidity::text, a.imap_uid::text, a.created_at
  from public.magnibox_imap_append_operations a
  join public.magnibox_sync_outbox o
    on o.id = a.outbox_event_id
   and o.organization_id = a.organization_id
  where a.organization_id = p_organization_id
    and a.folder_state_id = p_folder_state_id
    and (p_after_operation_id is null or a.id > p_after_operation_id)
    and (a.state <> 'confirmed' or a.uidvalidity <> p_current_uidvalidity)
  order by a.id
  limit p_limit;
end;
$recovery_inventory$;

revoke all on function public.magnibox_list_imap_append_recovery(uuid,uuid,bigint,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.magnibox_list_imap_append_recovery(uuid,uuid,bigint,uuid,integer)
  to service_role;

commit;
