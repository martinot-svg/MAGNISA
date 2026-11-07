begin;
drop policy if exists regulatory_watch_settings_admin_manage on public.regulatory_watch_settings;
drop policy if exists regulatory_watch_settings_admin_insert on public.regulatory_watch_settings;
drop policy if exists regulatory_watch_settings_admin_update on public.regulatory_watch_settings;
create policy regulatory_watch_settings_admin_insert on public.regulatory_watch_settings
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner','admin','director']));
create policy regulatory_watch_settings_admin_update on public.regulatory_watch_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner','admin','director']))
  with check (public.has_org_role(organization_id, array['owner','admin','director']));
commit;
