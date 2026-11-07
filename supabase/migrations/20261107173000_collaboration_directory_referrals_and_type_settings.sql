-- Complete the collaborative CRM directory, referral attribution and configurable activity catalog.
-- Additive and tenant-scoped. No existing business rows are rewritten.

create table if not exists public.prospect_intervention_type_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intervention_type text not null check (intervention_type in (
    'recommendation','prospecting','contact','presentation','qualification','negotiation',
    'transfer','closing','signature','follow_up','retention'
  )),
  label text not null check (length(trim(label)) between 2 and 80),
  is_active boolean not null default true,
  requires_evidence boolean not null default false,
  sort_order smallint not null default 0 check (sort_order between 0 and 1000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, intervention_type)
);

alter table public.prospect_intervention_type_settings enable row level security;
revoke all on public.prospect_intervention_type_settings from anon, authenticated;
grant select on public.prospect_intervention_type_settings to authenticated;
drop policy if exists prospect_intervention_type_settings_select on public.prospect_intervention_type_settings;
create policy prospect_intervention_type_settings_select
on public.prospect_intervention_type_settings
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'commissions.contribute')
  or public.has_org_permission(organization_id,'commissions.policy.manage')
  or public.has_org_permission(organization_id,'commissions.audit')
);

drop policy if exists prospect_interventions_select on public.prospect_interventions;
create policy prospect_interventions_select on public.prospect_interventions
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'commissions.contribute')
  or public.has_org_permission(organization_id,'commissions.policy.manage')
  or public.has_org_permission(organization_id,'commissions.audit')
  or contributor_user_id=(select auth.uid())
  or created_by=(select auth.uid())
);

drop policy if exists prospect_intervention_history_select on public.prospect_intervention_history;
create policy prospect_intervention_history_select on public.prospect_intervention_history
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'commissions.policy.manage')
  or public.has_org_permission(organization_id,'commissions.audit')
  or actor_user_id=(select auth.uid())
);

create or replace function public.seed_prospect_intervention_type_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $seed$
begin
  insert into public.prospect_intervention_type_settings(
    organization_id,intervention_type,label,is_active,requires_evidence,sort_order
  )
  values
    (new.id,'recommendation','Recommandation',true,false,10),
    (new.id,'prospecting','Prospection',true,false,20),
    (new.id,'contact','Prise de contact',true,false,30),
    (new.id,'presentation','Présentation',true,false,40),
    (new.id,'qualification','Qualification',true,false,50),
    (new.id,'negotiation','Négociation',true,false,60),
    (new.id,'transfer','Transfert',true,false,70),
    (new.id,'closing','Conclusion',true,false,80),
    (new.id,'signature','Signature',true,false,90),
    (new.id,'follow_up','Suivi',true,false,100),
    (new.id,'retention','Fidélisation',true,false,110)
  on conflict (organization_id,intervention_type) do nothing;
  return new;
end;
$seed$;

drop trigger if exists seed_prospect_intervention_type_settings on public.organizations;
create trigger seed_prospect_intervention_type_settings
after insert on public.organizations
for each row execute function public.seed_prospect_intervention_type_settings();

insert into public.prospect_intervention_type_settings(
  organization_id,intervention_type,label,is_active,requires_evidence,sort_order
)
select o.id,v.intervention_type,v.label,true,false,v.sort_order
from public.organizations o
cross join (values
  ('recommendation','Recommandation',10),
  ('prospecting','Prospection',20),
  ('contact','Prise de contact',30),
  ('presentation','Présentation',40),
  ('qualification','Qualification',50),
  ('negotiation','Négociation',60),
  ('transfer','Transfert',70),
  ('closing','Conclusion',80),
  ('signature','Signature',90),
  ('follow_up','Suivi',100),
  ('retention','Fidélisation',110)
) as v(intervention_type,label,sort_order)
on conflict (organization_id,intervention_type) do nothing;

create or replace function public.list_collaboration_members(p_org uuid)
returns table(user_id uuid, role text, department text, status text, email text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $members$
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'sales.view')
    or public.has_org_permission(p_org,'commissions.contribute')
  ) then
    raise exception 'Accès au répertoire commercial refusé.';
  end if;
  return query
  select m.user_id,m.role,m.department,m.status,p.email
  from public.organization_members m
  join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org
  order by (m.status='active') desc, p.email;
end;
$members$;

create or replace function public.list_prospect_intervention_types(p_org uuid)
returns table(intervention_type text,label text,is_active boolean,requires_evidence boolean,sort_order smallint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $types$
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'sales.view')
    or public.has_org_permission(p_org,'commissions.contribute')
    or public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'Accès au catalogue des interventions refusé.';
  end if;
  return query
  select s.intervention_type,s.label,s.is_active,s.requires_evidence,s.sort_order
  from public.prospect_intervention_type_settings s
  where s.organization_id=p_org
  order by s.sort_order,s.label;
end;
$types$;

create or replace function public.save_prospect_intervention_types(p_org uuid,p_types jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $save$
declare
  v_item jsonb;
  v_type text;
  v_label text;
  v_active boolean;
  v_requires_evidence boolean;
  v_sort integer;
  v_seen text[] := array[]::text[];
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.policy.manage') then
    raise exception 'La configuration des interventions est réservée aux responsables autorisés.';
  end if;
  if jsonb_typeof(p_types)<>'array' or jsonb_array_length(p_types)<>11 then
    raise exception 'Le catalogue doit contenir les onze types d''intervention.';
  end if;
  for v_item in select value from jsonb_array_elements(p_types)
  loop
    v_type := v_item->>'intervention_type';
    v_label := trim(coalesce(v_item->>'label',''));
    if v_type not in (
      'recommendation','prospecting','contact','presentation','qualification','negotiation',
      'transfer','closing','signature','follow_up','retention'
    ) or v_type=any(v_seen) then
      raise exception 'Type d''intervention inconnu ou dupliqué.';
    end if;
    if length(v_label)<2 or length(v_label)>80 then
      raise exception 'Chaque libellé doit contenir entre 2 et 80 caractères.';
    end if;
    v_active := coalesce((v_item->>'is_active')::boolean,false);
    v_requires_evidence := coalesce((v_item->>'requires_evidence')::boolean,false);
    v_sort := coalesce((v_item->>'sort_order')::integer,0);
    if v_sort<0 or v_sort>1000 then raise exception 'Ordre de tri invalide.'; end if;
    v_seen := array_append(v_seen,v_type);
    insert into public.prospect_intervention_type_settings(
      organization_id,intervention_type,label,is_active,requires_evidence,sort_order,updated_by,updated_at
    ) values (p_org,v_type,v_label,v_active,v_requires_evidence,v_sort,auth.uid(),now())
    on conflict (organization_id,intervention_type) do update set
      label=excluded.label,is_active=excluded.is_active,
      requires_evidence=excluded.requires_evidence,sort_order=excluded.sort_order,
      updated_by=excluded.updated_by,updated_at=now();
  end loop;
  if cardinality(v_seen)<>11 then raise exception 'Le catalogue est incomplet.'; end if;
end;
$save$;

-- Referrals are recorded at prospect creation but remain pending review.
create or replace function public.create_prospect_with_referrer(
  p_org uuid,p_name text,p_email text default null,p_phone text default null,
  p_source text default null,p_notes text default null,p_referrer_user_id uuid default null,
  p_referrer_evidence_reference text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $referral$
declare
  v_prospect uuid;
  v_department text;
  v_intervention uuid;
  v_recommendation_active boolean;
  v_requires_evidence boolean;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas le droit de créer un prospect.';
  end if;
  if p_referrer_user_id is not null then
    if p_referrer_user_id=auth.uid() then
      raise exception 'L''initiateur ne peut pas être déclaré comme son propre recommandeur.';
    end if;
    select department into v_department
    from public.organization_members
    where organization_id=p_org and user_id=p_referrer_user_id and status='active';
    if not found then
      raise exception 'Le recommandeur doit être un membre actif de cette entreprise.';
    end if;
    select is_active,requires_evidence into v_recommendation_active,v_requires_evidence
    from public.prospect_intervention_type_settings
    where organization_id=p_org and intervention_type='recommendation';
    if not found or not v_recommendation_active then
      raise exception 'Le type Recommandation est désactivé pour cette entreprise.';
    end if;
    if v_requires_evidence and length(trim(coalesce(p_referrer_evidence_reference,'')))=0 then
      raise exception 'Un justificatif est obligatoire pour cette recommandation.';
    end if;
  end if;
  v_prospect := public.create_prospect_with_originator(
    p_org,p_name,p_email,p_phone,p_source,p_notes
  );
  if p_referrer_user_id is not null then
    insert into public.prospect_interventions(
      organization_id,prospect_id,contributor_user_id,created_by,department_snapshot,
      intervention_type,contribution_role,stage_status,validation_status,description,evidence_reference
    ) values (
      p_org,v_prospect,p_referrer_user_id,auth.uid(),v_department,
      'recommendation','recommender','completed','pending',
      'Recommandation déclarée lors de la création du prospect ; validation requise.',
      nullif(trim(coalesce(p_referrer_evidence_reference,'')),'')
    ) returning id into v_intervention;
    insert into public.prospect_intervention_history(
      organization_id,intervention_id,action,actor_user_id,new_value,justification
    ) values (
      p_org,v_intervention,'created',auth.uid(),
      jsonb_build_object('contributor_user_id',p_referrer_user_id,'department',v_department,
        'type','recommendation','role','recommender','validation_status','pending'),
      'Recommandation déclarée à la création, soumise à validation indépendante.'
    );
  end if;
  return v_prospect;
end;
$referral$;

-- Enforce organization-configured types and evidence requirements inside the privileged RPC.
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
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas l''autorisation d''enregistrer une intervention.';
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
    organization_id,intervention_id,action,actor_user_id,new_value,justification
  ) values (
    p_org,v_id,case when p_type='transfer' then 'transferred' else 'created' end,auth.uid(),
    jsonb_build_object('contributor_user_id',p_contributor,'department',v_department,
      'type',p_type,'role',p_role,'stage_status',p_stage_status,'responsible_user_id',p_responsible),
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



-- A contributor cannot approve their own declaration, even when they hold a review role.
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
  if v_row.created_by=auth.uid() then
    raise exception 'Tu ne peux pas valider ou rejeter ta propre déclaration.';
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
  if p_decision='validate' and v_prospect_id is not null then
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

revoke all on public.prospect_intervention_type_settings from anon;
revoke all on function public.seed_prospect_intervention_type_settings() from public,anon,authenticated;
revoke all on function public.list_collaboration_members(uuid) from public,anon;
revoke all on function public.list_prospect_intervention_types(uuid) from public,anon;
revoke all on function public.save_prospect_intervention_types(uuid,jsonb) from public,anon;
revoke all on function public.create_prospect_with_referrer(uuid,text,text,text,text,text,uuid,text) from public,anon;
revoke all on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) from public,anon;
grant execute on function public.list_collaboration_members(uuid) to authenticated;
grant execute on function public.list_prospect_intervention_types(uuid) to authenticated;
grant execute on function public.save_prospect_intervention_types(uuid,jsonb) to authenticated;
grant execute on function public.create_prospect_with_referrer(uuid,text,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
