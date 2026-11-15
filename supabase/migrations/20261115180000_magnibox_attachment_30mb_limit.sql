-- Raise MAGNIBOX attachment limits consistently across storage and metadata.
-- Existing rows remain valid; new uploads may contain files up to 30 MiB each.
update storage.buckets
set public = false,
    file_size_limit = 31457280,
    allowed_mime_types = null
where id = 'magnibox-attachments';

alter table public.orbit_external_message_attachments
  drop constraint if exists orbit_external_message_attachments_byte_size_check;

alter table public.orbit_external_message_attachments
  add constraint orbit_external_attachment_byte_size_limit
  check (byte_size between 1 and 31457280);

create or replace function private.orbit_limit_external_message_attachments()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $orbit_attachment_limit$
declare
  current_count integer;
  current_bytes bigint;
begin
  perform 1 from public.orbit_external_messages
    where id = new.message_id and organization_id = new.organization_id
    for update;
  if not found then
    raise exception 'MAGNIBOX message not found';
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
