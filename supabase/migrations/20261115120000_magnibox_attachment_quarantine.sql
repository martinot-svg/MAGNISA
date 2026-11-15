-- MAGNIBOX attachments: private quarantine foundation.
-- Files remain inaccessible until a trusted malware scanner marks them available.
-- No client upload policy is created; only the server service role may write objects/metadata.

alter table public.orbit_external_messages
  add constraint orbit_external_messages_id_org_unique unique (id, organization_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'magnibox-attachments',
  'magnibox-attachments',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.orbit_external_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  message_id uuid not null,
  storage_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 180),
  detected_mime_type text not null check (char_length(detected_mime_type) between 1 and 120),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text not null default 'quarantined'
    check (scan_status in ('quarantined','scanning','available','rejected')),
  scan_completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint orbit_external_attachment_message_same_org
    foreign key (message_id, organization_id)
    references public.orbit_external_messages(id, organization_id) on delete cascade,
  constraint orbit_external_attachment_scan_state
    check (
      (scan_status in ('quarantined','scanning') and scan_completed_at is null)
      or (scan_status in ('available','rejected') and scan_completed_at is not null)
    )
);
create index orbit_external_attachment_message_idx
  on public.orbit_external_message_attachments(message_id, created_at);

-- Serialize per-message inserts to enforce both the count and aggregate-size caps.
create function private.orbit_limit_external_message_attachments()
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

  select count(*), coalesce(sum(byte_size), 0)
    into current_count, current_bytes
    from public.orbit_external_message_attachments
    where message_id = new.message_id;

  if current_count >= 5 or current_bytes + new.byte_size > 20971520 then
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
create trigger trg_orbit_external_attachment_limits
  before insert on public.orbit_external_message_attachments
  for each row execute function private.orbit_limit_external_message_attachments();

alter table public.orbit_external_message_attachments enable row level security;
create policy orbit_external_attachment_read on public.orbit_external_message_attachments
  for select to authenticated
  using (
    scan_status = 'available'
    and public.orbit_can_public_mail_access(organization_id, (
      select m.identity_id from public.orbit_external_messages m
      where m.id = orbit_external_message_attachments.message_id
        and m.organization_id = orbit_external_message_attachments.organization_id
    ), 'read')
  );

revoke all on public.orbit_external_message_attachments from public, anon, authenticated;
grant select on public.orbit_external_message_attachments to authenticated;

-- Intentionally no storage.objects policies: browser clients cannot list, upload,
-- overwrite, or download quarantined objects. Service-role transport/scanner only.
