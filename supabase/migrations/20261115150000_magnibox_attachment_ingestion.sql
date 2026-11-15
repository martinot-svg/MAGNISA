-- Attachment uploads are accepted into a private quarantine bucket.
-- MIME declarations from SMTP senders are untrusted; the scanner determines the actual type.
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = null
where id = 'magnibox-attachments';
