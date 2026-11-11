-- Allow the authorized declarant to verify a recommendation made by another colleague.
-- The beneficiary still cannot validate their own contribution.
create or replace function public.review_prospect_intervention(
  p_org uuid,p_intervention uuid,p_decision text,p_reason text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $review$
declare
  v_row public.prospect_interventions%rowtype;
  v_commission_role text;
  v_prospect_id uuid;
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'La validation des contributions est réservée aux responsables habilités.';
  end if;
  if p_decision is null or p_decision not in ('validate','reject')
     or length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'La décision et sa justification sont obligatoires.';
  end if;
  select * into v_row from public.prospect_interventions
  where id=p_intervention and organization_id=p_org for update;
  if not found then raise exception 'Intervention introuvable.'; end if;
  if v_row.contributor_user_id=auth.uid() then
    raise exception 'Tu ne peux pas valider ou rejeter une intervention dont tu es le bénéficiaire.';
  end if;
  if v_row.validation_status<>'pending' then
    raise exception 'Cette intervention a déjà été examinée.';
  end if;
  update public.prospect_interventions
  set validation_status=case when p_decision='validate' then 'validated' else 'rejected' end,
      reviewed_by=auth.uid(),reviewed_at=now(),review_reason=trim(p_reason)
  where id=p_intervention and organization_id=p_org;
  insert into public.prospect_intervention_history(
    organization_id,intervention_id,action,actor_user_id,previous_value,new_value,justification
  ) values (
    p_org,p_intervention,case when p_decision='validate' then 'validated' else 'rejected' end,
    auth.uid(),jsonb_build_object('validation_status','pending'),
    jsonb_build_object('validation_status',case when p_decision='validate' then 'validated' else 'rejected' end),
    trim(p_reason)
  );
  if v_row.prospect_id is not null then
    v_prospect_id := v_row.prospect_id;
  else
    select id into v_prospect_id from public.prospects
    where organization_id=p_org and converted_customer_id=v_row.customer_id limit 1;
  end if;
  if p_decision='validate' and v_prospect_id is not null and v_row.stage_status='completed' then
    v_commission_role := case v_row.contribution_role
      when 'initiator' then 'originator'
      when 'recommender' then 'originator'
      when 'prospector' then 'qualifier'
      when 'qualifier' then 'qualifier'
      when 'negotiator' then 'negotiator'
      when 'closer' then 'closer'
      else null end;
    if v_commission_role is not null then
      insert into public.prospect_contributors(
        organization_id,prospect_id,user_id,contribution_type,notes,created_by
      ) values (
        p_org,v_prospect_id,v_row.contributor_user_id,v_commission_role,
        'Contribution validée · intervention '||p_intervention::text,auth.uid()
      ) on conflict (organization_id,prospect_id,user_id,contribution_type)
      do update set notes=concat_ws(E'\\n',public.prospect_contributors.notes,
        'Contribution validée · intervention '||p_intervention::text);
    end if;
  end if;
end;
$review$;

revoke all on function public.review_prospect_intervention(uuid,uuid,text,text) from public,anon;
grant execute on function public.review_prospect_intervention(uuid,uuid,text,text) to authenticated;
