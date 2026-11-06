-- Restrict commission writes to validated SECURITY DEFINER RPCs.
-- Direct table writes could bypass calculation, approval and accounting controls.

drop policy if exists commission_policies_insert on public.commission_policies;
drop policy if exists commission_policies_update on public.commission_policies;
drop policy if exists commission_policy_rules_insert on public.commission_policy_rules;
drop policy if exists commission_policy_rules_update on public.commission_policy_rules;
drop policy if exists commission_policy_rules_delete on public.commission_policy_rules;
drop policy if exists prospect_contributors_insert on public.prospect_contributors;
drop policy if exists commission_calculations_insert on public.commission_calculations;
drop policy if exists commission_calculations_update on public.commission_calculations;
drop policy if exists commission_allocations_insert on public.commission_allocations;
drop policy if exists commission_payments_insert on public.commission_payments;

revoke insert, update, delete, truncate on public.commission_policies from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_policy_rules from public, anon, authenticated;
revoke insert, update, delete, truncate on public.prospect_contributors from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_calculations from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_allocations from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commission_payments from public, anon, authenticated;

create or replace function public.add_prospect_contributor(
  p_org uuid,
  p_prospect uuid,
  p_user uuid,
  p_contribution_type text,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.policy.manage') then
    raise exception 'Affectation réservée aux responsables autorisés.';
  end if;
  if p_org is null or p_prospect is null or p_user is null then
    raise exception 'Organisation, prospect et membre obligatoires.';
  end if;
  if p_user=auth.uid() then
    raise exception 'Tu ne peux pas t''affecter toi-même. La création d''un prospect t''enregistre automatiquement comme apporteur.';
  end if;
  if p_contribution_type is null or p_contribution_type not in ('originator','qualifier','negotiator','closer') then
    raise exception 'Type de contribution invalide.';
  end if;
  if length(trim(coalesce(p_notes,''))) > 1000 then
    raise exception 'La précision dépasse 1 000 caractères.';
  end if;
  if not exists (
    select 1 from public.prospects p
    where p.id=p_prospect and p.organization_id=p_org
  ) then
    raise exception 'Prospect introuvable dans cette organisation.';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id=p_org and m.user_id=p_user and m.status='active'
  ) then
    raise exception 'Le membre sélectionné n''est pas actif dans cette organisation.';
  end if;

  insert into public.prospect_contributors(
    organization_id,prospect_id,user_id,contribution_type,notes,created_by
  ) values (
    p_org,p_prospect,p_user,p_contribution_type,nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  )
  on conflict (organization_id,prospect_id,user_id,contribution_type) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.prospect_contributors
    where organization_id=p_org and prospect_id=p_prospect
      and user_id=p_user and contribution_type=p_contribution_type;
    return v_id;
  end if;

  perform public.audit_event(
    p_org,'commission.contributor.assigned','prospect_contributors',v_id,null,
    jsonb_build_object('prospect_id',p_prospect,'user_id',p_user,
      'contribution_type',p_contribution_type,'assigned_by',auth.uid())
  );
  return v_id;
end;
$$;

create or replace function public.list_commission_assignable_members(p_org uuid)
returns table(user_id uuid, role text, email text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.policy.manage') then
    raise exception 'Accès réservé aux responsables autorisés.';
  end if;
  return query
  select m.user_id,m.role,p.email
  from public.organization_members m
  join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org and m.status='active'
    and m.user_id<>auth.uid()
  order by m.role,p.email;
end;
$$;

revoke all on function public.add_prospect_contributor(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.add_prospect_contributor(uuid,uuid,uuid,text,text) to authenticated;
revoke all on function public.list_commission_assignable_members(uuid) from public, anon;
grant execute on function public.list_commission_assignable_members(uuid) to authenticated;
