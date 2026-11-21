-- Durable per-recipient outbound SMTP delivery state.
-- A Postfix "sent" event means remote-MTA acceptance, not mailbox delivery.
create table public.orbit_external_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.orbit_external_messages(id) on delete cascade,
  recipient_email text not null,
  state text not null default 'local_accepted'
    check (state in ('local_accepted','remote_accepted','deferred','bounced','failed')),
  last_event_id text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint orbit_external_recipient_email_nonempty
    check (char_length(btrim(recipient_email)) between 3 and 320),
  constraint orbit_external_message_recipient_unique
    unique (message_id, recipient_email)
);
create index orbit_external_recipient_message_idx
  on public.orbit_external_message_recipients(message_id);

create table public.orbit_external_delivery_event_receipts (
  event_id text primary key,
  message_id uuid not null references public.orbit_external_messages(id) on delete cascade,
  recipient_email text not null,
  event_state text not null
    check (event_state in ('remote_accepted','deferred','bounced','failed')),
  received_at timestamptz not null default now(),
  constraint orbit_external_delivery_event_id_valid
    check (event_id ~ '^[a-f0-9]{64}$')
);

alter table public.orbit_external_message_recipients enable row level security;
alter table public.orbit_external_delivery_event_receipts enable row level security;
revoke all on public.orbit_external_message_recipients from public, anon, authenticated;
revoke all on public.orbit_external_delivery_event_receipts from public, anon, authenticated;
grant select on public.orbit_external_message_recipients to authenticated;

-- Backfill known recipient lists for messages with a Postfix queue ID.
insert into public.orbit_external_message_recipients(message_id,recipient_email,state)
select m.id, lower(btrim(recipient)), case
  when m.status = 'delivered' then 'remote_accepted'
  when m.status = 'bounced' then 'bounced'
  when m.status = 'failed' then 'failed'
  when m.status = 'uncertain' then 'deferred'
  else 'local_accepted'
end
from public.orbit_external_messages m
cross join lateral unnest(m.to_emails) as recipient
where m.direction='outgoing' and m.provider_email_id is not null
  and btrim(recipient) <> ''
on conflict (message_id,recipient_email) do nothing;

create or replace function public.orbit_apply_magnibox_recipient_delivery_event(
  p_queue_id text,
  p_recipient_email text,
  p_event_id text,
  p_event_state text
) returns text
language plpgsql
security definer
set search_path = ''
as $magnibox_recipient_event$
declare
  v_message_id uuid;
  v_recipient_id uuid;
  v_recipient text;
  v_current text;
  v_inserted integer;
begin
  v_recipient := lower(btrim(coalesce(p_recipient_email,'')));
  if p_queue_id is null or upper(p_queue_id) !~ '^[A-F0-9]{5,20}$'
    or v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or p_event_id is null or p_event_id !~ '^[a-f0-9]{64}$'
    or p_event_state not in ('remote_accepted','deferred','bounced','failed') then
    raise exception 'Invalid MAGNIBOX recipient delivery event' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('magnibox-recipient:'||upper(p_queue_id)||':'||v_recipient,0)
  );

  select m.id into v_message_id
  from public.orbit_external_messages m
  where m.direction='outgoing' and m.provider_email_id=upper(p_queue_id)
    and v_recipient=any(select lower(btrim(x)) from unnest(m.to_emails) x)
  limit 1;
  if v_message_id is null then return 'not_found'; end if;

  insert into public.orbit_external_message_recipients(message_id,recipient_email,state)
  values(v_message_id,v_recipient,'local_accepted')
  on conflict(message_id,recipient_email) do nothing;

  insert into public.orbit_external_delivery_event_receipts(event_id,message_id,recipient_email,event_state)
  values(p_event_id,v_message_id,v_recipient,p_event_state)
  on conflict(event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return 'duplicate'; end if;

  select r.id,r.state into v_recipient_id,v_current
  from public.orbit_external_message_recipients r
  where r.message_id=v_message_id and r.recipient_email=v_recipient
  for update;

  -- Terminal bounce/failure cannot be overwritten by a later stale success.
  if v_current in ('bounced','failed') then return 'ignored'; end if;
  if v_current='remote_accepted' and p_event_state='deferred' then return 'ignored'; end if;

  update public.orbit_external_message_recipients
  set state=p_event_state,last_event_id=p_event_id,last_event_at=now(),updated_at=now()
  where id=v_recipient_id;

  return 'updated';
end;
$magnibox_recipient_event$;

revoke all on function public.orbit_apply_magnibox_recipient_delivery_event(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.orbit_apply_magnibox_recipient_delivery_event(text,text,text,text)
  to service_role;

comment on table public.orbit_external_message_recipients is
  'Per-recipient outbound SMTP state; remote_accepted means remote MTA accepted the message, not inbox delivery.';
