-- Brouillons de la messagerie interne MAGNIBOX.
-- Les brouillons sont privés à leur auteur et restent soumis aux droits d'envoi de la boîte.
create table if not exists public.mgmail_internal_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.mgmail_internal_namespaces(organization_id) on delete cascade,
  sender_mailbox_id uuid not null,
  recipient_mailbox_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null default '' check (char_length(subject) <= 180),
  body_text text not null default '' check (char_length(body_text) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mgmail_draft_sender_same_org
    foreign key (sender_mailbox_id, organization_id)
    references public.mgmail_internal_mailboxes(id, organization_id) on delete cascade,
  constraint mgmail_draft_recipient_same_org
    foreign key (recipient_mailbox_id, organization_id)
    references public.mgmail_internal_mailboxes(id, organization_id) on delete set null
);

create index if not exists mgmail_internal_drafts_owner_idx
  on public.mgmail_internal_drafts(organization_id, created_by, updated_at desc);

alter table public.mgmail_internal_drafts enable row level security;

create policy mgmail_internal_drafts_select
  on public.mgmail_internal_drafts for select to authenticated
  using (
    created_by = (select auth.uid())
    and public.mgmail_has_internal_access(organization_id, sender_mailbox_id, 'send')
  );

create policy mgmail_internal_drafts_insert
  on public.mgmail_internal_drafts for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.mgmail_has_internal_access(organization_id, sender_mailbox_id, 'send')
    and (recipient_mailbox_id is null or exists (
      select 1 from public.mgmail_internal_mailboxes r
      where r.id = recipient_mailbox_id and r.organization_id = mgmail_internal_drafts.organization_id and r.is_active
    ))
  );

create policy mgmail_internal_drafts_update
  on public.mgmail_internal_drafts for update to authenticated
  using (
    created_by = (select auth.uid())
    and public.mgmail_has_internal_access(organization_id, sender_mailbox_id, 'send')
  )
  with check (
    created_by = (select auth.uid())
    and public.mgmail_has_internal_access(organization_id, sender_mailbox_id, 'send')
    and (recipient_mailbox_id is null or exists (
      select 1 from public.mgmail_internal_mailboxes r
      where r.id = recipient_mailbox_id and r.organization_id = organization_id and r.is_active
    ))
  );

create policy mgmail_internal_drafts_delete
  on public.mgmail_internal_drafts for delete to authenticated
  using (
    created_by = (select auth.uid())
    and public.mgmail_has_internal_access(organization_id, sender_mailbox_id, 'send')
  );

revoke all on public.mgmail_internal_drafts from anon, authenticated;
grant select, delete on public.mgmail_internal_drafts to authenticated;
grant insert (organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text)
  on public.mgmail_internal_drafts to authenticated;
grant update (recipient_mailbox_id, subject, body_text)
  on public.mgmail_internal_drafts to authenticated;

create or replace function private.mgmail_touch_internal_draft()
returns trigger language plpgsql
set search_path = pg_catalog, public, private
as $touch$
begin
  new.updated_at := now();
  return new;
end;
$touch$;
revoke all on function private.mgmail_touch_internal_draft() from public, anon, authenticated;
drop trigger if exists trg_mgmail_touch_internal_draft on public.mgmail_internal_drafts;
create trigger trg_mgmail_touch_internal_draft
  before update on public.mgmail_internal_drafts
  for each row execute function private.mgmail_touch_internal_draft();

-- Sending a saved draft and deleting it are one transaction: no duplicate send
-- can be caused by a successful message insert followed by a failed draft delete.
create or replace function public.mgmail_send_internal_draft(p_draft_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $send_draft$
declare
  v_draft public.mgmail_internal_drafts%rowtype;
begin
  select * into v_draft
  from public.mgmail_internal_drafts
  where id = p_draft_id and created_by = (select auth.uid())
  for update;

  if not found
    or v_draft.recipient_mailbox_id is null
    or char_length(btrim(v_draft.subject)) < 1
    or char_length(btrim(v_draft.body_text)) < 1
    or not public.mgmail_can_send_internal(
      v_draft.organization_id, v_draft.sender_mailbox_id, v_draft.recipient_mailbox_id
    ) then
    return false;
  end if;

  insert into public.mgmail_internal_messages (
    organization_id, sender_mailbox_id, recipient_mailbox_id, subject, body_text
  ) values (
    v_draft.organization_id, v_draft.sender_mailbox_id, v_draft.recipient_mailbox_id,
    btrim(v_draft.subject), btrim(v_draft.body_text)
  );

  delete from public.mgmail_internal_drafts where id = v_draft.id;
  return true;
end;
$send_draft$;
revoke all on function public.mgmail_send_internal_draft(uuid) from public, anon;
grant execute on function public.mgmail_send_internal_draft(uuid) to authenticated;
