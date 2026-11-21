-- Server-only RPC boundary for the MAGNIBOX encrypted IMAP credential vault.
begin;

create or replace function public.magnibox_store_imap_credential(
  p_organization_id uuid, p_mailbox_id uuid, p_envelope_version smallint,
  p_algorithm text, p_key_id text, p_nonce text, p_ciphertext text,
  p_auth_tag text, p_idempotency_key text
) returns table (credential_id uuid, credential_version integer, credential_status text)
language plpgsql security definer
set search_path = pg_catalog, public
as $store$
declare
  v_existing public.magnibox_imap_credentials%rowtype;
  v_version integer;
begin
  if p_envelope_version <> 1 or p_algorithm <> 'aes-256-gcm'
    or p_key_id !~ '^[A-Za-z0-9._-]{1,80}$'
    or char_length(p_nonce) <> 16 or char_length(p_auth_tag) <> 24
    or char_length(p_ciphertext) = 0
    or char_length(btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'Invalid MAGNIBOX credential envelope' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_mailbox_id::text, 0));
  select * into v_existing from public.magnibox_imap_credentials c
    where c.organization_id=p_organization_id and c.mailbox_id=p_mailbox_id
      and c.idempotency_key=p_idempotency_key;
  if found then
    return query select v_existing.id, v_existing.credential_version, v_existing.status;
    return;
  end if;
  update public.magnibox_imap_credentials c
    set status='revoked', revoked_at=now()
    where c.organization_id=p_organization_id and c.mailbox_id=p_mailbox_id and c.status='active';
  select coalesce(max(c.credential_version),0)+1 into v_version
    from public.magnibox_imap_credentials c
    where c.organization_id=p_organization_id and c.mailbox_id=p_mailbox_id;
  insert into public.magnibox_imap_credentials(
    organization_id,mailbox_id,credential_version,envelope_version,algorithm,
    key_id,nonce,ciphertext,auth_tag,idempotency_key,status
  ) values (p_organization_id,p_mailbox_id,v_version,p_envelope_version,
    p_algorithm,p_key_id,p_nonce,p_ciphertext,p_auth_tag,p_idempotency_key,'active')
  returning id, magnibox_imap_credentials.credential_version, magnibox_imap_credentials.status
    into credential_id, credential_version, credential_status;
  return next;
end;
$store$;

create or replace function public.magnibox_get_active_imap_credential(
  p_organization_id uuid, p_mailbox_id uuid
) returns table (credential_id uuid, organization_id uuid, mailbox_id uuid,
  credential_version integer, envelope_version smallint, algorithm text,
  key_id text, nonce text, ciphertext text, auth_tag text, status text)
language sql stable security definer
set search_path = pg_catalog, public
as $get$
  select c.id,c.organization_id,c.mailbox_id,c.credential_version,
    c.envelope_version,c.algorithm,c.key_id,c.nonce,c.ciphertext,c.auth_tag,c.status
  from public.magnibox_imap_credentials c
  where c.organization_id=p_organization_id and c.mailbox_id=p_mailbox_id
    and c.status='active'
    and exists (
      select 1 from public.magnibox_internal_mailboxes m
      where m.id=c.mailbox_id and m.organization_id=c.organization_id
        and m.is_active and m.can_read
    )
  limit 1;
$get$;

create or replace function public.magnibox_revoke_active_imap_credential(
  p_organization_id uuid, p_mailbox_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $revoke$
declare v_count integer;
begin
  -- Serialize revocation with rotation so a concurrent store cannot race
  -- the single-active-version invariant or leave a newly stored secret active.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_mailbox_id::text, 0));
  update public.magnibox_imap_credentials c set status='revoked',revoked_at=now()
  where c.organization_id=p_organization_id and c.mailbox_id=p_mailbox_id and c.status='active';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$revoke$;

revoke all on function public.magnibox_store_imap_credential(uuid,uuid,smallint,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.magnibox_get_active_imap_credential(uuid,uuid) from public,anon,authenticated;
revoke all on function public.magnibox_revoke_active_imap_credential(uuid,uuid) from public,anon,authenticated;
grant execute on function public.magnibox_store_imap_credential(uuid,uuid,smallint,text,text,text,text,text,text) to service_role;
grant execute on function public.magnibox_get_active_imap_credential(uuid,uuid) to service_role;
grant execute on function public.magnibox_revoke_active_imap_credential(uuid,uuid) to service_role;

commit;
