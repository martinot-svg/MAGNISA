-- Atomic, idempotent send for internal MAGNIBOX messages.
-- The same request UUID is reused on browser retries/double-clicks.
alter table public.mgmail_internal_messages
  add column if not exists client_request_id uuid;

create unique index if not exists mgmail_internal_messages_send_idempotency_uidx
  on public.mgmail_internal_messages(organization_id, sender_mailbox_id, client_request_id)
  where client_request_id is not null;

create or replace function public.mgmail_send_internal_message(
  p_organization_id uuid,
  p_sender_mailbox_id uuid,
  p_recipient_mailbox_id uuid,
  p_subject text,
  p_body_text text,
  p_request_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $send_internal$
declare
  v_message_id uuid;
begin
  if p_request_id is null
    or char_length(btrim(coalesce(p_subject, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_body_text, ''))) not between 1 and 50000
    or not public.mgmail_can_send_internal(
      p_organization_id, p_sender_mailbox_id, p_recipient_mailbox_id
    ) then
    raise exception 'MAGNIBOX: invalid message or send permission denied'
      using errcode = '42501';
  end if;

  insert into public.mgmail_internal_messages (
    organization_id, sender_mailbox_id, recipient_mailbox_id,
    subject, body_text, client_request_id
  ) values (
    p_organization_id, p_sender_mailbox_id, p_recipient_mailbox_id,
    btrim(p_subject), btrim(p_body_text), p_request_id
  )
  on conflict (organization_id, sender_mailbox_id, client_request_id)
    where client_request_id is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id
    from public.mgmail_internal_messages
    where organization_id = p_organization_id
      and sender_mailbox_id = p_sender_mailbox_id
      and client_request_id = p_request_id;
  end if;

  if v_message_id is null then
    raise exception 'MAGNIBOX: idempotent send could not be resolved'
      using errcode = '40001';
  end if;
  return v_message_id;
end;
$send_internal$;

revoke all on function public.mgmail_send_internal_message(uuid,uuid,uuid,text,text,uuid)
  from public, anon;
grant execute on function public.mgmail_send_internal_message(uuid,uuid,uuid,text,text,uuid)
  to authenticated;

revoke insert on public.mgmail_internal_messages from authenticated;
grant insert (
  organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
) on public.mgmail_internal_messages to authenticated;
