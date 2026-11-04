drop policy if exists notification_deliveries_service_role on public.notification_deliveries;
create policy notification_deliveries_service_role on public.notification_deliveries
  for all to service_role using (true) with check (true);
drop policy if exists notification_events_service_role on public.notification_events;
create policy notification_events_service_role on public.notification_events
  for all to service_role using (true) with check (true);