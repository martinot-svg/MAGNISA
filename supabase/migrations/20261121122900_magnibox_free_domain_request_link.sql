-- Connect a free MAGNIBOX platform-domain reservation to the existing
-- domain-request workflow. A reservation creates a PENDING request only:
-- platform ownership of the root does not prove tenant DNS or mail routing.
alter table public.magnibox_domain_requests
  add column if not exists platform_allocation_id uuid
  references public.magnibox_platform_domain_allocations(id) on delete set null;

create unique index if not exists magnibox_domain_requests_platform_allocation_uidx
  on public.magnibox_domain_requests(platform_allocation_id)
  where platform_allocation_id is not null;

create or replace function private.magnibox_create_domain_request_for_allocation()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,private
as $allocation_domain_request$
begin
  insert into public.magnibox_domain_requests(
    organization_id,domain_name,requested_by,platform_allocation_id
  ) values (
    new.organization_id,new.assigned_domain,new.requested_by,new.id
  )
  on conflict (organization_id,domain_name) do update
    set platform_allocation_id=coalesce(
      public.magnibox_domain_requests.platform_allocation_id,
      excluded.platform_allocation_id
    );

  return new;
end;
$allocation_domain_request$;

revoke all on function private.magnibox_create_domain_request_for_allocation()
  from public,anon,authenticated;

drop trigger if exists trg_magnibox_create_domain_request_for_allocation
  on public.magnibox_platform_domain_allocations;
create trigger trg_magnibox_create_domain_request_for_allocation
  after insert on public.magnibox_platform_domain_allocations
  for each row execute function private.magnibox_create_domain_request_for_allocation();

comment on column public.magnibox_domain_requests.platform_allocation_id is
  'Links a company domain request to a free MAGNIBOX platform allocation. Status remains pending until tenant DNS and mail routing are independently verified.';
