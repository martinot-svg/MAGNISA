-- MAGNISA collaborative CRM contribution ledger
-- Additive migration: immutable activity records, append-only review history and responsibility transfers.
alter table public.organization_members
  add column if not exists department text;

create table if not exists public.prospect_interventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  contributor_user_id uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  department_snapshot text,
  intervention_type text not null check (intervention_type in
    ('recommendation','prospecting','contact','presentation','qualification','negotiation','transfer','closing','signature','follow_up','retention')),
  contribution_role text not null check (contribution_role in
    ('initiator','recommender','prospector','qualifier','negotiator','closer','account_manager','support')),
  stage_status text not null default 'in_progress' check (stage_status in
    ('not_started','in_progress','completed','transferred','cancelled','blocked')),
  validation_status text not null default 'pending' check (validation_status in ('pending','validated','rejected')),
  description text not null check (length(trim(description)) between 3 and 4000),
  evidence_reference text,
  responsible_user_id uuid references auth.users(id),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text,
  constraint prospect_interventions_subject_check check (
    (prospect_id is not null and customer_id is null) or
    (prospect_id is null and customer_id is not null)
  ),
  constraint prospect_interventions_review_check check (
    (validation_status='pending' and reviewed_by is null and reviewed_at is null) or
    (validation_status in ('validated','rejected') and reviewed_by is not null and reviewed_at is not null)
  ),
  unique(id, organization_id)
);

create index if not exists prospect_interventions_prospect_timeline
  on public.prospect_interventions(organization_id, prospect_id, occurred_at desc);
create index if not exists prospect_interventions_customer_timeline
  on public.prospect_interventions(organization_id, customer_id, occurred_at desc);
create index if not exists prospect_interventions_contributor
  on public.prospect_interventions(organization_id, contributor_user_id, validation_status);

create table if not exists public.prospect_intervention_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intervention_id uuid not null,
  action text not null check (action in ('created','validated','rejected','transferred','reassigned')),
  actor_user_id uuid not null references auth.users(id),
  previous_value jsonb,
  new_value jsonb not null,
  justification text,
  created_at timestamptz not null default now(),
  foreign key (intervention_id, organization_id)
    references public.prospect_interventions(id, organization_id) on delete cascade
);
create index if not exists prospect_intervention_history_timeline
  on public.prospect_intervention_history(organization_id, intervention_id, created_at);

alter table public.prospect_interventions enable row level security;
alter table public.prospect_intervention_history enable row level security;

drop policy if exists prospect_interventions_select on public.prospect_interventions;
create policy prospect_interventions_select on public.prospect_interventions
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'commissions.contribute')
  or contributor_user_id=(select auth.uid())
  or created_by=(select auth.uid())
);
drop policy if exists prospect_intervention_history_select on public.prospect_intervention_history;
create policy prospect_intervention_history_select on public.prospect_intervention_history
for select to authenticated
using (
  public.has_org_permission(organization_id,'sales.view')
  or public.has_org_permission(organization_id,'commissions.audit')
  or actor_user_id=(select auth.uid())
);
revoke all on public.prospect_interventions, public.prospect_intervention_history from anon;
grant select on public.prospect_interventions, public.prospect_intervention_history to authenticated;

create or replace function public.record_prospect_intervention(
  p_org uuid,
  p_prospect uuid,
  p_customer uuid,
  p_contributor uuid,
  p_department text,
  p_type text,
  p_role text,
  p_stage_status text,
  p_description text,
  p_evidence text,
  p_responsible uuid,
  p_occurred_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_department text;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas l''autorisation d''enregistrer une intervention.';
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
  if p_type not in ('recommendation','prospecting','contact','presentation','qualification','negotiation','transfer','closing','signature','follow_up','retention')
     or p_role not in ('initiator','recommender','prospector','qualifier','negotiator','closer','account_manager','support')
     or p_stage_status not in ('not_started','in_progress','completed','transferred','cancelled','blocked')
     or length(trim(coalesce(p_description,'')))<3 then
    raise exception 'Les informations de l''intervention sont invalides.';
  end if;
  select coalesce(nullif(trim(p_department),''), nullif(trim(department),'')) into v_department
  from public.organization_members where organization_id=p_org and user_id=p_contributor;
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
  return v_id;
end;
$$;

create or replace function public.review_prospect_intervention(
  p_org uuid,p_intervention uuid,p_decision text,p_reason text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.prospect_interventions%rowtype;
  v_commission_role text;
begin
  if auth.uid() is null or not (
    public.has_org_permission(p_org,'commissions.policy.manage')
    or public.has_org_permission(p_org,'commissions.audit')
  ) then
    raise exception 'La validation des contributions est réservée aux responsables habilités.';
  end if;
  if p_decision not in ('validate','reject') or length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'La décision et sa justification sont obligatoires.';
  end if;
  select * into v_row from public.prospect_interventions
  where id=p_intervention and organization_id=p_org for update;
  if not found then raise exception 'Intervention introuvable.'; end if;
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

  if p_decision='validate' and v_row.prospect_id is not null then
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
        p_org,v_row.prospect_id,v_row.contributor_user_id,v_commission_role,
        'Contribution validée · intervention '||p_intervention::text,auth.uid()
      ) on conflict (organization_id,prospect_id,user_id,contribution_type)
      do update set notes=concat_ws(E'\n',public.prospect_contributors.notes,
        'Contribution validée · intervention '||p_intervention::text);
    end if;
  end if;
end;
$$;

create or replace function public.create_prospect_with_originator(
  p_org uuid,p_name text,p_email text default null,p_phone text default null,
  p_source text default null,p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prospect uuid;
  v_department text;
  v_intervention uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'commissions.contribute') then
    raise exception 'Tu n''as pas le droit de créer un prospect.';
  end if;
  if length(trim(coalesce(p_name,'')))<2 then raise exception 'Le nom du prospect est obligatoire.'; end if;
  select department into v_department from public.organization_members
    where organization_id=p_org and user_id=auth.uid() and status='active';
  insert into public.prospects(organization_id,name,email,phone,source,status,notes)
  values(p_org,trim(p_name),nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_source,'')),''),'new',nullif(trim(coalesce(p_notes,'')),'')) returning id into v_prospect;
  insert into public.prospect_contributors(organization_id,prospect_id,user_id,contribution_type,created_by)
  values(p_org,v_prospect,auth.uid(),'originator',auth.uid());
  insert into public.prospect_interventions(
    organization_id,prospect_id,contributor_user_id,created_by,department_snapshot,
    intervention_type,contribution_role,stage_status,validation_status,description,
    reviewed_by,reviewed_at,review_reason
  ) values (
    p_org,v_prospect,auth.uid(),auth.uid(),v_department,'prospecting','initiator',
    'completed','validated','Création du prospect : attribution initiale automatique.',
    auth.uid(),now(),'Attribution vérifiable par le journal de création MAGNISA'
  ) returning id into v_intervention;
  insert into public.prospect_intervention_history(
    organization_id,intervention_id,action,actor_user_id,new_value,justification
  ) values (
    p_org,v_intervention,'created',auth.uid(),
    jsonb_build_object('contributor_user_id',auth.uid(),'department',v_department,
      'role','initiator','stage_status','completed','validation_status','validated'),
    'Attribution initiale issue de la création authentifiée du prospect'
  );
  perform public.audit_event(p_org,'prospect.created','prospects',v_prospect,null,
    jsonb_build_object('name',trim(p_name),'source',p_source,'initiator',auth.uid(),'department',v_department));
  return v_prospect;
end;
$$;

revoke all on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) from public,anon;
revoke all on function public.review_prospect_intervention(uuid,uuid,text,text) from public,anon;
revoke all on function public.create_prospect_with_originator(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.record_prospect_intervention(uuid,uuid,uuid,uuid,text,text,text,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.review_prospect_intervention(uuid,uuid,text,text) to authenticated;
grant execute on function public.create_prospect_with_originator(uuid,text,text,text,text,text) to authenticated;


-- Guard commission creation: every contributor must have a matching validated intervention.
create or replace function public.assert_commission_contributors_validated()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.prospect_contributors c
    join public.prospect_interventions i
      on i.organization_id=c.organization_id
      and i.prospect_id=c.prospect_id
      and i.contributor_user_id=c.user_id
      and i.validation_status='validated'
      and case i.contribution_role
        when 'initiator' then 'originator'
        when 'recommender' then 'originator'
        when 'prospector' then 'qualifier'
        when 'qualifier' then 'qualifier'
        when 'negotiator' then 'negotiator'
        when 'closer' then 'closer'
        else null end = c.contribution_type
    where c.organization_id=new.organization_id and c.prospect_id=new.prospect_id
  ) or exists (
    select 1 from public.prospect_contributors c
    where c.organization_id=new.organization_id and c.prospect_id=new.prospect_id
      and not exists (
        select 1 from public.prospect_interventions i
        where i.organization_id=c.organization_id and i.prospect_id=c.prospect_id
          and i.contributor_user_id=c.user_id and i.validation_status='validated'
          and case i.contribution_role
            when 'initiator' then 'originator'
            when 'recommender' then 'originator'
            when 'prospector' then 'qualifier'
            when 'qualifier' then 'qualifier'
            when 'negotiator' then 'negotiator'
            when 'closer' then 'closer'
            else null end = c.contribution_type
      )
  ) then
    raise exception 'Commission bloquée : chaque contributeur doit posséder une intervention correspondante validée.';
  end if;
  return new;
end;
$$;
drop trigger if exists commission_contributors_validation_guard on public.commission_calculations;
create trigger commission_contributors_validation_guard
before insert on public.commission_calculations
for each row execute function public.assert_commission_contributors_validated();

-- CRM events are captured from real business transitions, but remain pending review.
create or replace function public.capture_confirmed_order_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status='confirmed' and old.status is distinct from new.status
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'closing',
      'support','completed','pending',
      'Événement CRM automatique : commande '||new.number||' confirmée.',
      'order:'||new.id::text,now()
    );
  end if;
  return new;
end;
$$;
drop trigger if exists crm_capture_confirmed_order on public.orders;
create trigger crm_capture_confirmed_order
after update of status on public.orders
for each row execute function public.capture_confirmed_order_contribution();

create or replace function public.capture_paid_invoice_contribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status='paid' and old.status is distinct from new.status
     and new.created_by is not null
     and exists (select 1 from public.organization_members
       where organization_id=new.organization_id and user_id=new.created_by and status='active') then
    insert into public.prospect_interventions(
      organization_id,customer_id,contributor_user_id,created_by,intervention_type,
      contribution_role,stage_status,validation_status,description,evidence_reference,occurred_at
    ) values (
      new.organization_id,new.customer_id,new.created_by,new.created_by,'follow_up',
      'support','completed','pending',
      'Événement CRM automatique : facture '||new.number||' entièrement soldée.',
      'invoice:'||new.id::text,now()
    );
  end if;
  return new;
end;
$$;
drop trigger if exists crm_capture_paid_invoice on public.invoices;
create trigger crm_capture_paid_invoice
after update of status on public.invoices
for each row execute function public.capture_paid_invoice_contribution();
