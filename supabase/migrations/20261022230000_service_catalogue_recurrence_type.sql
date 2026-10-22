-- Let the service catalogue distinguish one-off work from recurring services.
alter table public.services
  add column if not exists service_type text not null default 'one_off'
    check (service_type in ('one_off','recurring')),
  add column if not exists default_frequency text
    check (default_frequency is null or default_frequency in ('monthly','quarterly','semiannual','annual'));

update public.services
set default_frequency = null
where service_type = 'one_off' and default_frequency is not null;

create index if not exists services_org_type_active_idx
  on public.services (organization_id, service_type, is_active);
