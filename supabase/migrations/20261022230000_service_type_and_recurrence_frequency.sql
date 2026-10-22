-- Distinguish one-off service catalog items from recurring service offers.
alter table public.services
  add column if not exists service_type text not null default 'one_off',
  add column if not exists recurrence_frequency text;

update public.services
set service_type = coalesce(nullif(service_type, ''), 'one_off')
where service_type is null or service_type = '';

alter table public.services
  drop constraint if exists services_service_type_check,
  add constraint services_service_type_check
    check (service_type in ('one_off', 'recurring'));

alter table public.services
  drop constraint if exists services_recurrence_frequency_check,
  add constraint services_recurrence_frequency_check
    check (
      (service_type = 'one_off' and recurrence_frequency is null)
      or
      (service_type = 'recurring' and recurrence_frequency in ('monthly', 'quarterly', 'semiannual', 'annual'))
    );

update public.services
set recurrence_frequency = 'monthly'
where service_type = 'recurring' and recurrence_frequency is null;
