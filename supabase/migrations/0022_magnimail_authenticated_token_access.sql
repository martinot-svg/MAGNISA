-- Remove the server-wide service-role dependency from MagniMail.
-- OAuth credentials remain encrypted in the database and are only accessible
-- to the authenticated owner of the corresponding e-mail connection.

grant select, insert, update, delete on table public.email_connections to authenticated;
grant select, insert, update, delete on table public.email_connection_secrets to authenticated;
grant insert, update on table public.email_history to authenticated;

drop policy if exists email_connections_insert_own_admin on public.email_connections;
create policy email_connections_insert_own_admin
on public.email_connections
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_org_member(organization_id)
  and public.has_org_role(organization_id, array['owner','admin']::text[])
);

drop policy if exists email_connections_update_own_admin on public.email_connections;
create policy email_connections_update_own_admin
on public.email_connections
for update
to authenticated
using (
  user_id = (select auth.uid())
  and public.is_org_member(organization_id)
  and public.has_org_role(organization_id, array['owner','admin']::text[])
)
with check (
  user_id = (select auth.uid())
  and public.is_org_member(organization_id)
  and public.has_org_role(organization_id, array['owner','admin']::text[])
);

drop policy if exists email_connections_delete_own_admin on public.email_connections;
create policy email_connections_delete_own_admin
on public.email_connections
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and public.is_org_member(organization_id)
  and public.has_org_role(organization_id, array['owner','admin']::text[])
);

drop policy if exists email_connection_secrets_select_own on public.email_connection_secrets;
create policy email_connection_secrets_select_own
on public.email_connection_secrets
for select
to authenticated
using (
  exists (
    select 1
    from public.email_connections ec
    where ec.id = email_connection_secrets.connection_id
      and ec.user_id = (select auth.uid())
      and public.is_org_member(ec.organization_id)
  )
);

drop policy if exists email_connection_secrets_insert_own on public.email_connection_secrets;
create policy email_connection_secrets_insert_own
on public.email_connection_secrets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.email_connections ec
    where ec.id = email_connection_secrets.connection_id
      and ec.user_id = (select auth.uid())
      and public.is_org_member(ec.organization_id)
  )
);

drop policy if exists email_connection_secrets_update_own on public.email_connection_secrets;
create policy email_connection_secrets_update_own
on public.email_connection_secrets
for update
to authenticated
using (
  exists (
    select 1
    from public.email_connections ec
    where ec.id = email_connection_secrets.connection_id
      and ec.user_id = (select auth.uid())
      and public.is_org_member(ec.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.email_connections ec
    where ec.id = email_connection_secrets.connection_id
      and ec.user_id = (select auth.uid())
      and public.is_org_member(ec.organization_id)
  )
);

drop policy if exists email_connection_secrets_delete_own on public.email_connection_secrets;
create policy email_connection_secrets_delete_own
on public.email_connection_secrets
for delete
to authenticated
using (
  exists (
    select 1
    from public.email_connections ec
    where ec.id = email_connection_secrets.connection_id
      and ec.user_id = (select auth.uid())
      and public.is_org_member(ec.organization_id)
  )
);

drop policy if exists email_history_insert_own_connection on public.email_history;
create policy email_history_insert_own_connection
on public.email_history
for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (created_by is null or created_by = (select auth.uid()))
  and exists (
    select 1
    from public.email_connections ec
    where ec.id = email_history.connection_id
      and ec.organization_id = email_history.organization_id
      and ec.user_id = (select auth.uid())
  )
);

drop policy if exists email_history_update_own_connection on public.email_history;
create policy email_history_update_own_connection
on public.email_history
for update
to authenticated
using (
  public.is_org_member(organization_id)
  and exists (
    select 1
    from public.email_connections ec
    where ec.id = email_history.connection_id
      and ec.organization_id = email_history.organization_id
      and ec.user_id = (select auth.uid())
  )
)
with check (
  public.is_org_member(organization_id)
  and (created_by is null or created_by = (select auth.uid()))
  and exists (
    select 1
    from public.email_connections ec
    where ec.id = email_history.connection_id
      and ec.organization_id = email_history.organization_id
      and ec.user_id = (select auth.uid())
  )
);
