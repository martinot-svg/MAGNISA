-- Controlled CRM status transitions with tenant checks and immutable audit events.
create or replace function public.set_prospect_status(
  p_org uuid,
  p_prospect uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_old_status text;
  v_customer uuid;
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'sales.view')
    or public.has_org_permission(p_org,'quotes.edit')
    or public.has_org_permission(p_org,'customers.create')
  ) then
    raise exception 'Accès refusé pour modifier le statut commercial.';
  end if;

  if p_status is null or p_status not in ('new','qualified','proposal','lost') then
    raise exception 'Statut commercial invalide. La conversion gagnée doit passer par le parcours de conversion client.';
  end if;

  select status, converted_customer_id
    into v_old_status, v_customer
  from public.prospects
  where id=p_prospect and organization_id=p_org
  for update;

  if not found then raise exception 'Prospect introuvable dans cette entreprise.'; end if;
  if v_customer is not null or v_old_status='won' then
    raise exception 'Le prospect converti est clôturé et son statut ne peut plus être modifié.';
  end if;
  if v_old_status=p_status then return; end if;

  update public.prospects
    set status=p_status, updated_at=now()
  where id=p_prospect and organization_id=p_org;

  perform public.audit_event(
    p_org,
    'prospect.status_changed',
    'prospect',
    p_prospect,
    jsonb_build_object('status',v_old_status),
    jsonb_build_object('status',p_status)
  );
end;
$function$;

revoke all on function public.set_prospect_status(uuid,uuid,text) from public, anon;
grant execute on function public.set_prospect_status(uuid,uuid,text) to authenticated;
