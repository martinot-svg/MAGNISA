-- Keep mailbox read and send permissions independent while preserving the sender's Sent folder.
-- Check deliverability without exposing the recipient's grant roster to callers.
-- The function returns one boolean and is scoped to active members of the organization.
create or replace function public.magnibox_has_internal_reader(
  p_organization_id uuid,
  p_mailbox_id uuid
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $reader$
  select public.is_org_member(p_organization_id)
    and exists (
      select 1
      from public.magnibox_internal_mailboxes b
      where b.organization_id = p_organization_id
        and b.id = p_mailbox_id
        and b.is_active
        and (
          (
            b.owner_user_id is not null
            and b.can_read
            and exists (
              select 1 from public.organization_members m
              where m.organization_id = b.organization_id
                and m.user_id = b.owner_user_id
                and m.status = 'active'
            )
          )
          or exists (
            select 1
            from public.magnibox_internal_mailbox_grants g
            join public.organization_members m
              on m.organization_id = g.organization_id
             and m.user_id = g.user_id
             and m.status = 'active'
            where g.organization_id = b.organization_id
              and g.mailbox_id = b.id
              and g.is_active
              and g.can_read
          )
        )
    );
$reader$;
revoke all on function public.magnibox_has_internal_reader(uuid, uuid) from public, anon;
grant execute on function public.magnibox_has_internal_reader(uuid, uuid) to authenticated;

-- Return only mailbox IDs that can receive mail, never the private delegate roster.
create or replace function public.magnibox_list_deliverable_mailboxes(
  p_organization_id uuid
) returns setof uuid
language sql stable security definer
set search_path = pg_catalog, public
as $deliverable$
  select b.id
  from public.magnibox_internal_mailboxes b
  where public.is_org_member(p_organization_id)
    and b.organization_id = p_organization_id
    and b.is_active
    and public.magnibox_has_internal_reader(p_organization_id, b.id);
$deliverable$;
revoke all on function public.magnibox_list_deliverable_mailboxes(uuid) from public, anon;
grant execute on function public.magnibox_list_deliverable_mailboxes(uuid) to authenticated;

-- Enforce deliverability at the same database boundary as sender authorization.
create or replace function public.magnibox_can_send_internal(
  p_organization_id uuid,
  p_sender_mailbox_id uuid,
  p_recipient_mailbox_id uuid
) returns boolean
language sql stable security invoker
set search_path = pg_catalog, public
as $send$
  select public.magnibox_has_internal_access(
      p_organization_id, p_sender_mailbox_id, 'send'
    )
    and public.magnibox_has_internal_reader(
      p_organization_id, p_recipient_mailbox_id
    );
$send$;
revoke all on function public.magnibox_can_send_internal(uuid, uuid, uuid) from public, anon;
grant execute on function public.magnibox_can_send_internal(uuid, uuid, uuid) to authenticated;

-- A send-only delegate may inspect messages sent from the delegated mailbox,
-- but cannot inspect its Inbox or mark received messages as read.
drop policy if exists magnibox_messages_select on public.magnibox_internal_messages;
create policy magnibox_messages_select
  on public.magnibox_internal_messages for select to authenticated
  using (
    public.magnibox_has_internal_access(organization_id, sender_mailbox_id, 'read')
    or public.magnibox_has_internal_access(organization_id, sender_mailbox_id, 'send')
    or public.magnibox_has_internal_access(organization_id, recipient_mailbox_id, 'read')
  );
