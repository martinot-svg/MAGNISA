-- Preserve the draft organization when its recipient mailbox is deleted.
-- PostgreSQL's default composite SET NULL would also null organization_id,
-- which is NOT NULL and is required to keep the draft scoped to its tenant.
alter table public.magnibox_internal_drafts
  drop constraint if exists magnibox_draft_recipient_same_org;

alter table public.magnibox_internal_drafts
  add constraint magnibox_draft_recipient_same_org
  foreign key (recipient_mailbox_id, organization_id)
  references public.magnibox_internal_mailboxes(id, organization_id)
  on delete set null (recipient_mailbox_id);
