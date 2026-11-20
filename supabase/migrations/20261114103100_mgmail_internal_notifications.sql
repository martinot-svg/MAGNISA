-- magnibox interne : indicateurs de lecture et notifications applicatives.
-- Aucun e-mail ni SMS n'est expédié par cette migration.
alter table public.magnibox_internal_messages
  add column if not exists read_at timestamptz;

-- Lecture/modification de l'état réservées au destinataire actuellement autorisé.
drop policy if exists magnibox_messages_mark_read on public.magnibox_internal_messages;
create policy magnibox_messages_mark_read
  on public.magnibox_internal_messages for update to authenticated
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.magnibox_internal_mailboxes receiver
      where receiver.id=recipient_mailbox_id
        and receiver.organization_id=magnibox_internal_messages.organization_id
        and receiver.owner_user_id=auth.uid()
        and receiver.is_active and receiver.can_read
    )
  )
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.magnibox_internal_mailboxes receiver
      where receiver.id=recipient_mailbox_id
        and receiver.organization_id=magnibox_internal_messages.organization_id
        and receiver.owner_user_id=auth.uid()
        and receiver.is_active and receiver.can_read
    )
  );

grant update (read_at) on public.magnibox_internal_messages to authenticated;

-- Les notifications sont créées côté base, pour le seul destinataire du message,
-- dans le centre de notifications déjà existant. Jamais de notification ouverte
-- à toute l'entreprise pour une correspondance potentiellement privée.
create or replace function private.magnibox_notify_internal_message()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,private
as $$
declare
  v_recipient uuid;
begin
  select mb.owner_user_id into v_recipient
    from public.magnibox_internal_mailboxes mb
    join public.organization_members om
      on om.organization_id=mb.organization_id
      and om.user_id=mb.owner_user_id
      and om.status='active'
    where mb.id=new.recipient_mailbox_id
      and mb.organization_id=new.organization_id
      and mb.is_active and mb.can_read;

  if v_recipient is null then return new; end if;
  insert into public.notifications (
    organization_id,recipient_user_id,category,priority,title,body,action_url,
    entity_type,entity_id,metadata,dedupe_key
  ) values (
    new.organization_id,v_recipient,'service','info',
    'Nouveau message dans magnibox',
    'Un nouveau message interne vous attend dans MAGNISA.',
    '/magnimail/interne',
    'magnibox_internal_message',new.id,
    jsonb_build_object('channel','internal','message_id',new.id),
    'magnibox-internal-message:' || new.id::text
  ) on conflict (organization_id,recipient_user_id,dedupe_key) do nothing;
  return new;
end;
$$;

revoke all on function private.magnibox_notify_internal_message()
  from public,anon,authenticated;

drop trigger if exists trg_magnibox_notify_internal_message
  on public.magnibox_internal_messages;
create trigger trg_magnibox_notify_internal_message
  after insert on public.magnibox_internal_messages
  for each row execute function private.magnibox_notify_internal_message();
