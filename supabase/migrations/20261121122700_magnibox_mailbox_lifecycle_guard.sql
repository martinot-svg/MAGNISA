-- MAGNIBOX mailbox lifecycle: a disabled internal mailbox must never remain
-- an externally routable identity. Historical magnibox rows are not renamed.
create or replace function private.orbit_public_identity_mailbox_activation_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $magnibox_guard$
begin
  if new.status='active' and not exists (
    select 1 from public.magnibox_internal_mailboxes m
    where m.id=new.mailbox_id
      and m.organization_id=new.organization_id
      and m.is_active
  ) then
    raise exception 'MAGNIBOX identity requires an active mailbox';
  end if;
  return new;
end;
$magnibox_guard$;
revoke all on function private.orbit_public_identity_mailbox_activation_guard()
  from public,anon,authenticated;

drop trigger if exists trg_orbit_identity_mailbox_activation
  on public.orbit_public_identities;
create trigger trg_orbit_identity_mailbox_activation
  before insert or update of status,mailbox_id,organization_id
  on public.orbit_public_identities
  for each row execute function private.orbit_public_identity_mailbox_activation_guard();

create or replace function private.orbit_suspend_public_identity_for_inactive_mailbox()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $magnibox_suspend$
begin
  if old.is_active and not new.is_active then
    update public.orbit_public_identities
      set status='suspended',receive_enabled=false,updated_at=now()
      where mailbox_id=new.id
        and organization_id=new.organization_id
        and status='active';
  end if;
  return new;
end;
$magnibox_suspend$;
revoke all on function private.orbit_suspend_public_identity_for_inactive_mailbox()
  from public,anon,authenticated;

drop trigger if exists trg_orbit_mailbox_inactive on public.magnibox_internal_mailboxes;
create trigger trg_orbit_mailbox_inactive
  after update of is_active on public.magnibox_internal_mailboxes
  for each row
  when (old.is_active and not new.is_active)
  execute function private.orbit_suspend_public_identity_for_inactive_mailbox();

comment on function private.orbit_suspend_public_identity_for_inactive_mailbox() is
  'Immediately suspends public MAGNIBOX identities when their linked company mailbox is disabled.';
