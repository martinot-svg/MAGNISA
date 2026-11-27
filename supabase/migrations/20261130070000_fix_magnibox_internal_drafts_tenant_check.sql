BEGIN;

-- Prevent an authenticated sender from attaching an active recipient mailbox
-- from another organization when updating an internal draft.
DROP POLICY IF EXISTS magnibox_internal_drafts_update ON public.magnibox_internal_drafts;
CREATE POLICY magnibox_internal_drafts_update
  ON public.magnibox_internal_drafts
  FOR UPDATE TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    AND public.magnibox_has_internal_access(organization_id, sender_mailbox_id, 'send')
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.magnibox_has_internal_access(organization_id, sender_mailbox_id, 'send')
    AND (
      recipient_mailbox_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.magnibox_internal_mailboxes r
        WHERE r.id = magnibox_internal_drafts.recipient_mailbox_id
          AND r.organization_id = magnibox_internal_drafts.organization_id
          AND r.is_active
      )
    )
  );

COMMIT;
