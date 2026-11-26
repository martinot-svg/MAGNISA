-- Keep mailbox read and send permissions independent while preserving the sender's Sent folder.
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
