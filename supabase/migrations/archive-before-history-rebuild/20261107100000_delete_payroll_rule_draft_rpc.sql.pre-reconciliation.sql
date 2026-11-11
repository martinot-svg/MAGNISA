-- Delete only unvalidated payroll-rule drafts through a permission-checked RPC.
-- The DELETE trigger writes the immutable audit record before the row is removed.
begin;

create or replace function public.delete_payroll_rule_draft(
  p_org uuid,
  p_rule uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  if p_confirmation is distinct from 'SUPPRIMER' then
    raise exception 'Confirmation de suppression invalide';
  end if;

  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org, 'payroll.manage') then
    raise exception 'Suppression non autorisée : permission payroll.manage requise';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text), 1742);

  select status
    into v_status
    from public.payroll_rule_sets
   where id = p_rule
     and organization_id = p_org
   for update;

  if not found then
    raise exception 'Référentiel introuvable pour cette organisation';
  end if;

  if v_status not in ('draft', 'pending_review') then
    raise exception 'Une version validée ou archivée ne peut pas être supprimée';
  end if;

  delete from public.payroll_rule_sets
   where id = p_rule
     and organization_id = p_org;
end
$function$;

revoke all on function public.delete_payroll_rule_draft(uuid, uuid, text)
  from public, anon;
grant execute on function public.delete_payroll_rule_draft(uuid, uuid, text)
  to authenticated;

comment on function public.delete_payroll_rule_draft(uuid, uuid, text) is
'Deletes only a confirmed draft or pending payroll rule for an authorized organization member; the delete audit trigger preserves the deletion event.';

commit;
