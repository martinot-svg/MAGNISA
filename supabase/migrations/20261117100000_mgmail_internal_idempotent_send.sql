-- Atomic, idempotent send for internal MAGNIBOX messages.
-- The same request UUID is reused on browser retries/double-clicks.
alter table public.magnibox_internal_messages
  add column if not exists client_request_id uuid;

create unique index if not exists magnibox_internal_messages_send_idempotency_uidx
  on public.magnibox_internal_messages(organization_id, sender_mailbox_id, client_request_id)
  where client_request_id is not null;

create or replace function public.magnibox_send_internal_message(
  p_organization_id uuid,
  p_sender_mailbox_id uuid,
  p_recipient_mailbox_id uuid,
  p_subject text,
  p_body_text text,
  p_request_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $send_internal$
declare
  v_message_id uuid;
begin
  if p_request_id is null
    or char_length(btrim(coalesce(p_subject, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_body_text, ''))) not between 1 and 50000
    or not public.magnibox_can_send_internal(
      p_organization_id, p_sender_mailbox_id, p_recipient_mailbox_id
    ) then
    raise exception 'MAGNIBOX: invalid message or send permission denied'
      using errcode = '42501';
  end if;

  insert into public.magnibox_internal_messages (
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
    from public.magnibox_internal_messages
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

revoke all on function public.magnibox_send_internal_message(uuid,uuid,uuid,text,text,uuid)
  from public, anon;
grant execute on function public.magnibox_send_internal_message(uuid,uuid,uuid,text,text,uuid)
  to authenticated;

-- All authenticated sends must use the guarded RPC; this prevents bypassing
-- the idempotency key with direct table inserts. The definer function checks
-- the caller's JWT membership and explicit mailbox send grant before writing.
revoke insert on public.magnibox_internal_messages from authenticated;
revoke insert (
  organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
) on public.magnibox_internal_messages from authenticated;

-- Draft submission must use the same guarded privileged path because direct
-- INSERT permission on the messages table is intentionally removed.
create or replace function public.magnibox_send_internal_draft(p_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $send_draft$
declare
  v_draft public.magnibox_internal_drafts%rowtype;
begin
  select * into v_draft
  from public.magnibox_internal_drafts
  where id = p_draft_id and created_by = (select auth.uid())
  for update;

  if not found
    or v_draft.recipient_mailbox_id is null
    or char_length(btrim(v_draft.subject)) < 1
    or char_length(btrim(v_draft.body_text)) < 1
    or not public.magnibox_can_send_internal(
      v_draft.organization_id, v_draft.sender_mailbox_id, v_draft.recipient_mailbox_id
    ) then
    return false;
  end if;

  insert into public.magnibox_internal_messages (
    organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
  ) values (
    v_draft.organization_id, v_draft.sender_mailbox_id, v_draft.recipient_mailbox_id,
    btrim(v_draft.subject), btrim(v_draft.body_text)
  );

  delete from public.magnibox_internal_drafts where id = v_draft.id;
  return true;
end;
$send_draft$;
revoke all on function public.magnibox_send_internal_draft(uuid) from public, anon;
grant execute on function public.magnibox_send_internal_draft(uuid) to authenticated;
