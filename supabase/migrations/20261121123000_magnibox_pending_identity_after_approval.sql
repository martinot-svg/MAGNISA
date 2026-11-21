-- Create a pending public identity only after central approval of an address.
-- This does not activate SMTP or expose the address to Postfix: provider proof,
-- verified domain, and an active mailbox are still required for activation.
create or replace function private.magnibox_create_pending_identity_after_address_approval()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $pending_identity$
declare
  v_domain_status text;
  v_mailbox_active boolean;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select d.status, m.is_active
    into v_domain_status, v_mailbox_active
    from public.magnibox_domain_requests d
    join public.magnibox_internal_mailboxes m
      on m.id=new.mailbox_id and m.organization_id=new.organization_id
    where d.id=new.domain_request_id
      and d.organization_id=new.organization_id
      and d.domain_name=new.domain_name;

  if not found or v_domain_status <> 'verified' or v_mailbox_active is distinct from true then
    raise exception 'Approved MAGNIBOX address requires a verified domain and active mailbox'
      using errcode='23514';
  end if;

  -- Idempotent on repeated status updates; a conflicting email owned by a
  -- different request remains a hard uniqueness failure, never reassigned.
  if not exists (
    select 1 from public.orbit_public_identities i
    where i.address_request_id=new.id
      and i.organization_id=new.organization_id
  ) then
    insert into public.orbit_public_identities (
      organization_id, domain_request_id, address_request_id, mailbox_id,
      domain_name, local_part, provider, status, receive_enabled
    ) values (
      new.organization_id, new.domain_request_id, new.id, new.mailbox_id,
      new.domain_name, new.local_part, 'smtp', 'pending', false
    );
  end if;

  return new;
end;
$pending_identity$;

revoke all on function private.magnibox_create_pending_identity_after_address_approval()
  from public,anon,authenticated;

drop trigger if exists trg_magnibox_create_pending_identity_after_address_approval
  on public.magnibox_public_address_requests;
create trigger trg_magnibox_create_pending_identity_after_address_approval
  after update of status on public.magnibox_public_address_requests
  for each row execute function private.magnibox_create_pending_identity_after_address_approval();

comment on function private.magnibox_create_pending_identity_after_address_approval() is
  'Creates a pending, non-routable MAGNIBOX identity after central address approval. DNS/provider verification and explicit activation remain separate.';
