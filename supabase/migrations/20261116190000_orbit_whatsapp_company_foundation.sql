-- ORBIT WhatsApp Business: company-owned account foundation.
-- No Meta credentials are provisioned by this migration. Tokens are ciphertext only.
begin;

create table public.orbit_whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  waba_id text not null check (char_length(waba_id) between 1 and 128),
  phone_number_id text not null unique check (char_length(phone_number_id) between 1 and 128),
  display_phone_number text not null default '' check (char_length(display_phone_number) <= 40),
  verified_name text not null default '' check (char_length(verified_name) <= 160),
  access_token_ciphertext text,
  token_key_version smallint,
  token_expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','active','expired','disconnected','error')),
  last_error_code text,
  last_error_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint orbit_whatsapp_active_has_ciphertext
    check (status <> 'active' or (access_token_ciphertext is not null and token_key_version is not null))
);
create unique index orbit_whatsapp_one_active_connection_per_org
  on public.orbit_whatsapp_connections(organization_id)
  where status = 'active';
create index orbit_whatsapp_connections_org_status_idx
  on public.orbit_whatsapp_connections(organization_id,status);

create table public.orbit_whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wa_id text not null check (char_length(wa_id) between 5 and 64),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name text not null default '' check (char_length(display_name) <= 160),
  customer_id uuid references public.customers(id) on delete set null,
  opt_in_status text not null default 'unknown'
    check (opt_in_status in ('unknown','opted_in','opted_out')),
  opt_in_source text check (opt_in_source is null or char_length(opt_in_source) <= 160),
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,wa_id),
  unique (id,organization_id),
  constraint orbit_whatsapp_contact_opt_in_consistency
    check ((opt_in_status <> 'opted_in' or opt_in_at is not null)
      and (opt_in_status <> 'opted_out' or opt_out_at is not null))
);

create table public.orbit_whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  contact_id uuid not null,
  status text not null default 'open' check (status in ('open','archived')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text not null default '' check (char_length(last_message_preview) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organization_id),
  unique (connection_id,contact_id),
  constraint orbit_whatsapp_conversation_connection_same_org
    foreign key(connection_id,organization_id)
    references public.orbit_whatsapp_connections(id,organization_id) on delete cascade,
  constraint orbit_whatsapp_conversation_contact_same_org
    foreign key(contact_id,organization_id)
    references public.orbit_whatsapp_contacts(id,organization_id) on delete cascade
);
create index orbit_whatsapp_conversations_inbox_idx
  on public.orbit_whatsapp_conversations(organization_id,status,last_message_at desc);

create table public.orbit_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text'
    check (message_type in ('text','image','video','audio','document','location','template','interactive','unknown')),
  text_body text not null default '' check (char_length(text_body) <= 10000),
  media_storage_path text,
  media_mime_type text,
  media_file_name text check (media_file_name is null or char_length(media_file_name) <= 180),
  meta_message_id text,
  client_request_id uuid,
  status text not null default 'received'
    check (status in ('received','queued','accepted','sent','delivered','read','failed')),
  error_code text,
  error_detail text check (error_detail is null or char_length(error_detail) <= 500),
  template_name text check (template_name is null or char_length(template_name) <= 160),
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id,organization_id),
  constraint orbit_whatsapp_message_conversation_same_org
    foreign key(conversation_id,organization_id)
    references public.orbit_whatsapp_conversations(id,organization_id) on delete cascade,
  constraint orbit_whatsapp_message_direction_status
    check ((direction='inbound' and status='received')
      or (direction='outbound' and status<>'received')),
  constraint orbit_whatsapp_message_idempotency
    check (direction <> 'outbound' or client_request_id is not null)
);
create unique index orbit_whatsapp_provider_message_id_idx
  on public.orbit_whatsapp_messages(meta_message_id) where meta_message_id is not null;
create unique index orbit_whatsapp_client_request_idx
  on public.orbit_whatsapp_messages(organization_id,client_request_id)
  where client_request_id is not null;
create index orbit_whatsapp_messages_timeline_idx
  on public.orbit_whatsapp_messages(organization_id,conversation_id,created_at desc);

create table public.orbit_whatsapp_message_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid,
  provider_event_key text not null unique check (char_length(provider_event_key) between 1 and 240),
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload_redacted jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  constraint orbit_whatsapp_event_message_same_org
    foreign key(message_id,organization_id)
    references public.orbit_whatsapp_messages(id,organization_id) on delete cascade
);
create index orbit_whatsapp_events_org_time_idx
  on public.orbit_whatsapp_message_events(organization_id,received_at desc);

create table public.orbit_whatsapp_document_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null,
  document_type text not null check (document_type in ('invoice','quote')),
  document_id uuid not null,
  recipient_contact_id uuid not null,
  file_name text not null check (char_length(file_name) between 1 and 180),
  status text not null default 'queued'
    check (status in ('queued','accepted','sent','delivered','read','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint orbit_whatsapp_dispatch_message_same_org
    foreign key(message_id,organization_id)
    references public.orbit_whatsapp_messages(id,organization_id) on delete cascade,
  constraint orbit_whatsapp_dispatch_contact_same_org
    foreign key(recipient_contact_id,organization_id)
    references public.orbit_whatsapp_contacts(id,organization_id) on delete restrict
);
create index orbit_whatsapp_dispatch_document_idx
  on public.orbit_whatsapp_document_dispatches(organization_id,document_type,document_id,created_at desc);

alter table public.orbit_whatsapp_connections enable row level security;
alter table public.orbit_whatsapp_contacts enable row level security;
alter table public.orbit_whatsapp_conversations enable row level security;
alter table public.orbit_whatsapp_messages enable row level security;
alter table public.orbit_whatsapp_message_events enable row level security;
alter table public.orbit_whatsapp_document_dispatches enable row level security;

-- Connection secrets are never selectable by authenticated browser sessions.
revoke all on public.orbit_whatsapp_connections from public,anon,authenticated;
grant select (
  id,organization_id,waba_id,phone_number_id,display_phone_number,
  verified_name,token_expires_at,status,last_error_code,last_error_at,
  connected_by,created_at,updated_at
) on public.orbit_whatsapp_connections to authenticated;
create policy orbit_whatsapp_connections_read
  on public.orbit_whatsapp_connections for select to authenticated
  using (public.has_org_permission(organization_id,'settings.manage'));

revoke all on public.orbit_whatsapp_contacts from public,anon,authenticated;
grant select on public.orbit_whatsapp_contacts to authenticated;
create policy orbit_whatsapp_contacts_read
  on public.orbit_whatsapp_contacts for select to authenticated
  using (public.has_org_permission(organization_id,'billing.view')
    or public.has_org_permission(organization_id,'sales.view'));

revoke all on public.orbit_whatsapp_conversations from public,anon,authenticated;
grant select on public.orbit_whatsapp_conversations to authenticated;
create policy orbit_whatsapp_conversations_read
  on public.orbit_whatsapp_conversations for select to authenticated
  using (public.has_org_permission(organization_id,'billing.view')
    or public.has_org_permission(organization_id,'sales.view'));

revoke all on public.orbit_whatsapp_messages from public,anon,authenticated;
grant select on public.orbit_whatsapp_messages to authenticated;
create policy orbit_whatsapp_messages_read
  on public.orbit_whatsapp_messages for select to authenticated
  using (public.has_org_permission(organization_id,'billing.view')
    or public.has_org_permission(organization_id,'sales.view'));

-- Provider payloads and document dispatch metadata are server-managed.
revoke all on public.orbit_whatsapp_message_events from public,anon,authenticated;
revoke all on public.orbit_whatsapp_document_dispatches from public,anon,authenticated;
grant select on public.orbit_whatsapp_document_dispatches to authenticated;
create policy orbit_whatsapp_document_dispatches_read
  on public.orbit_whatsapp_document_dispatches for select to authenticated
  using (public.has_org_permission(organization_id,'billing.view'));

-- Private bucket: no browser object policies. Upload/download must go through
-- authorized server code using short-lived signed URLs after tenant checks.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'orbit-whatsapp-media','orbit-whatsapp-media',false,16777216,
  array['application/pdf','image/jpeg','image/png','image/webp','audio/ogg',
    'audio/mpeg','audio/mp4','video/mp4','text/plain']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

commit;
