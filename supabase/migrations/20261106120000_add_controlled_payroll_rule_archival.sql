-- Controlled archival for validated payroll rule sets.
-- Current effective rules cannot be archived: a successor must first be validated.
create or replace function public.archive_payroll_rule(p_org uuid, p_rule uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v public.payroll_rule_sets%rowtype;
  v_archive_end date;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  perform public.assert_org_access(p_org);
  if not public.has_org_permission(p_org, 'payroll.manage') then
    raise exception 'Archivage non autorisé : permission payroll.manage requise';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org::text), 1742);

  select * into v
    from public.payroll_rule_sets
   where id = p_rule and organization_id = p_org
   for update;

  if not found then
    raise exception 'Référentiel introuvable pour cette organisation';
  end if;

  if v.status <> 'validated' then
    raise exception 'Seul un référentiel validé peut être archivé';
  end if;

  -- Never interrupt the rule currently governing today's payroll.
  if v.effective_from <= current_date
     and (v.effective_to is null or v.effective_to >= current_date) then
    raise exception 'Ce référentiel couvre la date actuelle. Valide d’abord une version de remplacement avant de l’archiver.';
  end if;

  if v.effective_from > current_date then
    -- A future rule is withdrawn without leaving an open-ended active period.
    v_archive_end := v.effective_from;
  elsif v.effective_to is null then
    v_archive_end := current_date - 1;
  else
    v_archive_end := v.effective_to;
  end if;

  perform set_config('app.payroll_rule_activation', 'on', true);

  update public.payroll_rule_sets
     set status = 'archived',
         effective_to = v_archive_end,
         updated_at = now()
   where id = p_rule and organization_id = p_org;
end
$function$;

revoke all on function public.archive_payroll_rule(uuid, uuid) from public, anon;
grant execute on function public.archive_payroll_rule(uuid, uuid) to authenticated;

comment on function public.archive_payroll_rule(uuid, uuid) is
'Archives a validated payroll rule only when it does not govern the current date; preserves the rule row and audit history.';
