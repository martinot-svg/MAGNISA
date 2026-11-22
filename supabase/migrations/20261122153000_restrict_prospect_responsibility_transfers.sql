-- Ownership transfers are privileged CRM operations. Enforce this in the
-- SECURITY DEFINER RPC as well as in the application server action.
create or replace function public.record_prospect_intervention(
  p_org uuid,p_prospect uuid,p_customer uuid,p_contributor uuid,p_department text,
  p_type text,p_role text,p_stage_status text,p_description text,p_evidence text,
  p_responsible uuid,p_occurred_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $record$
declare
  v_id uuid;
  v_department text;
  v_type_active boolean;
  v_requires_evidence boolean;
  v_previous_owner uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas l''autorisation d''enregistrer une intervention.';
  end if;
  if p_type='transfer' and not (
    public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'Le transfert de responsabilité est réservé aux responsables habilités.';
  end if;
  if p_contributor is distinct from auth.uid() and not (
    public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'Tu ne peux enregistrer une contribution qu''en ton propre nom.';
  end if;
  if (p_prospect is null) = (p_customer is null) then
    raise exception 'Sélectionne exactement un prospect ou un client.';
  end if;
  if p_prospect is not null and not exists (
    select 1 from public.prospects where id=p_prospect and organization_id=p_org
  ) then raise exception 'Prospect introuvable dans cette entreprise.'; end if;
  if p_customer is not null and not exists (
    select 1 from public.customers where id=p_customer and organization_id=p_org
  ) then raise exception 'Client introuvable dans cette entreprise.'; end if;
  if not exists (select 1 from public.organization_members
    where organization_id=p_org and user_id=p_contributor and status='active') then
    raise exception 'Le collaborateur doit être un membre actif de cette entreprise.';
  end if;
  if p_responsible is not null and not exists (select 1 from public.organization_members
    where organization_id=p_org and user_id=p_responsible and status='active') then
    raise exception 'Le nouveau responsable doit être un membre actif de cette entreprise.';
  end if;
  if p_type='transfer' and (p_responsible is null or p_stage_status<>'transferred') then
    raise exception 'Un transfert exige un nouveau responsable actif et le statut transféré.';
  end if;
  if p_type<>'transfer' and (p_responsible is not null or p_stage_status='transferred') then
    raise exception 'Seule une intervention de transfert peut changer le responsable.';
  end if;
  if p_type='transfer' and p_role not in ('support','account_manager') then
    raise exception 'Un transfert ne constitue pas à lui seul une contribution commissionnable.';
  end if;
  if p_type not in (
    'recommendation','prospecting','contact','presentation','qualification','negotiation',
    'transfer','closing','signature','follow_up','retention'
  ) or p_role not in (
    'initiator','recommender','prospector','qualifier','negotiator','closer','account_manager','support'
  ) or p_stage_status not in (
    'not_started','in_progress','completed','transferred','cancelled','blocked'
  ) or length(trim(coalesce(p_description,'')))<3 then
    raise exception 'Les informations de l''intervention sont invalides.';
  end if;
  select is_active,requires_evidence into v_type_active,v_requires_evidence
  from public.prospect_intervention_type_settings
  where organization_id=p_org and intervention_type=p_type;
  if not found or not v_type_active then
    raise exception 'Ce type d''intervention est désactivé ou non configuré.';
  end if;
  if v_requires_evidence and length(trim(coalesce(p_evidence,'')))=0 then
    raise exception 'Un justificatif est obligatoire pour ce type d''intervention.';
  end if;
  -- The department is sourced from the member directory, never trusted from a form field.
  select nullif(trim(department),'') into v_department
  from public.organization_members
  where organization_id=p_org and user_id=p_contributor;
  if p_type='transfer' then
    if p_prospect is not null then
      select current_owner_id into v_previous_owner from public.prospects
      where id=p_prospect and organization_id=p_org;
    else
      select current_owner_id into v_previous_owner from public.customers
      where id=p_customer and organization_id=p_org;
    end if;
  end if;
  insert into public.prospect_interventions(
    organization_id,prospect_id,customer_id,contributor_user_id,created_by,department_snapshot,
    intervention_type,contribution_role,stage_status,description,evidence_reference,
    responsible_user_id,occurred_at
  ) values (
    p_org,p_prospect,p_customer,p_contributor,auth.uid(),v_department,
    p_type,p_role,p_stage_status,trim(p_description),nullif(trim(coalesce(p_evidence,'')),''),
    p_responsible,coalesce(p_occurred_at,now())
  ) returning id into v_id;
  insert into public.prospect_intervention_history(
    organization_id,intervention_id,action,actor_user_id,previous_value,new_value,justification
  ) values (
    p_org,v_id,case when p_type='transfer' then 'transferred' else 'created' end,auth.uid(),
    case when p_type='transfer' then jsonb_build_object('current_owner_id',v_previous_owner) else null end,
    jsonb_build_object('contributor_user_id',p_contributor,'department',v_department,
      'type',p_type,'role',p_role,'stage_status',p_stage_status,
      'responsible_user_id',p_responsible,
      'current_owner_id',case when p_type='transfer' then p_responsible else null end),
    case when p_type='transfer' then 'Transfert de responsabilité enregistré' else null end
  );
  if p_type='transfer' then
    if p_prospect is not null then
      update public.prospects set current_owner_id=p_responsible,updated_at=now()
      where id=p_prospect and organization_id=p_org;
    else
      update public.customers set current_owner_id=p_responsible,updated_at=now()
      where id=p_customer and organization_id=p_org;
      update public.prospects set current_owner_id=p_responsible,updated_at=now()
      where converted_customer_id=p_customer and organization_id=p_org;
    end if;
  end if;
  return v_id;
end;
$record$;

revoke all on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) from public, anon;
grant execute on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
