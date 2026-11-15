-- Fence attachment scan workers so an expired worker cannot publish a stale verdict.
alter table public.orbit_external_message_attachments
  add column scan_lease_token uuid;

-- Make any pre-existing in-flight row retryable before enforcing the new lease invariant.
update public.orbit_external_message_attachments
set scan_status = 'quarantined',
    scan_started_at = null
where scan_status = 'scanning';

alter table public.orbit_external_message_attachments
  add constraint orbit_external_attachment_scan_token_state
  check (
    (scan_status = 'scanning' and scan_started_at is not null and scan_lease_token is not null)
    or (scan_status <> 'scanning' and scan_started_at is null and scan_lease_token is null)
  );

create index if not exists orbit_external_attachment_quarantine_created_idx
  on public.orbit_external_message_attachments (created_at)
  where scan_status = 'quarantined';
