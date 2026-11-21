-- MAGNIBOX encrypted IMAP credential vault. Ciphertext only; no plaintext secrets.
begin;

create table public.magnibox_imap_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  mailbox_id uuid not null,
  credential_version integer not null check (credential_version > 0),
  envelope_version smallint not null check (envelope_version = 1),
  algorithm text not null check (algorithm = 'aes-256-gcm'),
  key_id text not null check (key_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  nonce text not null check (char_length(nonce) = 16),
  ciphertext text not null check (char_length(ciphertext) > 0),
  auth_tag text not null check (char_length(auth_tag) = 24),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint magnibox_imap_credentials_mailbox_org_fk
    foreign key (mailbox_id, organization_id)
    references public.magnibox_internal_mailboxes(id, organization_id) on delete cascade,
  constraint magnibox_imap_credentials_revocation_ck check (
    (status = 'active' and revoked_at is null) or
    (status = 'revoked' and revoked_at is not null)
  ),
  constraint magnibox_imap_credentials_version_uidx unique (organization_id, mailbox_id, credential_version),
  constraint magnibox_imap_credentials_idempotency_uidx unique (organization_id, mailbox_id, idempotency_key)
);

create unique index magnibox_imap_credentials_one_active_uidx
  on public.magnibox_imap_credentials (organization_id, mailbox_id)
  where status = 'active';
create index magnibox_imap_credentials_history_idx
  on public.magnibox_imap_credentials (organization_id, mailbox_id, credential_version desc);

-- Credential envelopes are immutable. The only permitted update is active -> revoked.
create function private.magnibox_guard_imap_credential_update()
returns trigger
language plpgsql
set search_path = ''
as $guard$
begin
  if (new.id, new.organization_id, new.mailbox_id, new.credential_version,
      new.envelope_version, new.algorithm, new.key_id, new.nonce,
      new.ciphertext, new.auth_tag, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.mailbox_id, old.credential_version,
      old.envelope_version, old.algorithm, old.key_id, old.nonce,
      old.ciphertext, old.auth_tag, old.idempotency_key, old.created_at) then
    raise exception 'MAGNIBOX credential envelope is immutable' using errcode = '55000';
  end if;
  if old.status <> 'active' or new.status <> 'revoked' or new.revoked_at is null then
    raise exception 'MAGNIBOX credential transition must be active to revoked' using errcode = '55000';
  end if;
  return new;
end;
$guard$;
revoke all on function private.magnibox_guard_imap_credential_update() from public, anon, authenticated;
create trigger magnibox_imap_credentials_immutable
before update on public.magnibox_imap_credentials
for each row execute function private.magnibox_guard_imap_credential_update();

alter table public.magnibox_imap_credentials enable row level security;
revoke all on public.magnibox_imap_credentials from public, anon, authenticated;
grant select, insert, update on public.magnibox_imap_credentials to service_role;

commit;
