-- Bound retries and recover abandoned attachment scans after worker crashes.
alter table public.orbit_external_message_attachments
  add column scan_started_at timestamptz,
  add column scan_attempts integer not null default 0
    check (scan_attempts between 0 and 5);

alter table public.orbit_external_message_attachments
  add constraint orbit_external_attachment_scan_lease_state
  check (
    (scan_status = 'scanning' and scan_started_at is not null)
    or (scan_status <> 'scanning' and scan_started_at is null)
  );
