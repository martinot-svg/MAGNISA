-- MAGNISA — Chantier 1 : catégories de services et historique des tarifs.
-- Additive migration: existing services, quotes, invoices and line snapshots are preserved.

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_org_id_id_unique unique (organization_id, id)
);

create unique index if not exists service_categories_org_name_unique
  on public.service_categories (organization_id, lower(trim(name)));

alter table public.services
  add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'services_category_org_fk'
      and conrelid = 'public.services'::regclass
  ) then
    alter table public.services
      add constraint services_category_org_fk
      foreign key (organization_id, category_id)
      references public.service_categories (organization_id, id)
      on delete set null (category_id);
  end if;
end $$;

create index if not exists services_org_category_active_idx
  on public.services (organization_id, category_id, is_active);

create table if not exists public.service_price_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  unit text not null,
  unit_price numeric(18,2) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint service_price_versions_service_org_fk
    foreign key (organization_id, service_id)
    references public.services (organization_id, id) on delete restrict,
  constraint service_price_versions_period_check
    check (effective_until is null or effective_until > effective_from)
);

create index if not exists service_price_versions_lookup_idx
  on public.service_price_versions (organization_id, service_id, effective_from desc);

create unique index if not exists service_price_versions_one_current
  on public.service_price_versions (organization_id, service_id)
  where effective_until is null;

alter table public.service_categories enable row level security;
alter table public.service_price_versions enable row level security;

drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select on public.service_categories
for select to authenticated
using (
  public.has_org_permission(organization_id, 'sales.view')
  or public.has_org_permission(organization_id, 'billing.view')
);

drop policy if exists service_price_versions_select on public.service_price_versions;
create policy service_price_versions_select on public.service_price_versions
for select to authenticated
using (
  public.has_org_permission(organization_id, 'sales.view')
  or public.has_org_permission(organization_id, 'billing.view')
);

-- Backfill a current price version for existing services without changing their values.
insert into public.service_price_versions
  (organization_id, service_id, unit, unit_price, tax_rate, effective_from)
select s.organization_id, s.id, s.unit, s.unit_price, s.tax_rate, s.created_at
from public.services s
where not exists (
  select 1 from public.service_price_versions v
  where v.organization_id = s.organization_id
    and v.service_id = s.id
    and v.effective_until is null
);

create or replace function public.create_service_category_with_services(
  p_org uuid,
  p_category_name text,
  p_category_description text,
  p_services jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_category uuid;
  v_item jsonb;
  v_service uuid;
  v_name text;
  v_unit text;
  v_price numeric;
  v_tax numeric;
  v_cost numeric;
  v_margin numeric;
  v_allowed_units text[] := array[
    'forfait','unite','heure','demi_journee','jour','nuitee','semaine',
    'mois','annee','minute','seance','intervention','trajet','colis',
    'personne','dossier','m2'
  ];
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'services.create');

  if p_category_name is null or char_length(trim(p_category_name)) < 2
     or char_length(trim(p_category_name)) > 120 then
    raise exception 'Nom de catégorie invalide';
  end if;
  if p_services is null or jsonb_typeof(p_services) <> 'array'
     or jsonb_array_length(p_services) > 100 then
    raise exception 'La liste des prestations doit contenir au maximum 100 éléments';
  end if;

  insert into public.service_categories (organization_id, name, description)
  values (p_org, trim(p_category_name), nullif(trim(coalesce(p_category_description,'')), ''))
  returning id into v_category;

  for v_item in select value from jsonb_array_elements(p_services)
  loop
    v_name := nullif(trim(coalesce(v_item->>'name','')), '');
    v_unit := coalesce(nullif(trim(v_item->>'unit'), ''), 'forfait');

    if v_name is null or char_length(v_name) > 180 then
      raise exception 'Nom de prestation invalide';
    end if;
    if not (v_unit = any(v_allowed_units)) then
      raise exception 'Unité de facturation non autorisée: %', v_unit;
    end if;

    begin
      v_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_tax := coalesce((v_item->>'tax_rate')::numeric, 0);
      v_cost := coalesce((v_item->>'direct_cost_estimate')::numeric, 0);
      v_margin := nullif(v_item->>'margin_target_pct','')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Valeur numérique invalide pour la prestation %', v_name;
    end;

    if v_price < 0 or v_cost < 0 or v_tax < 0 or v_tax > 100
       or (v_margin is not null and (v_margin < 0 or v_margin > 100)) then
      raise exception 'Tarif, coût ou taux invalide pour la prestation %', v_name;
    end if;

    insert into public.services (
      organization_id, category_id, name, description, reference, unit,
      unit_price, tax_rate, direct_cost_estimate, margin_target_pct
    ) values (
      p_org, v_category, v_name,
      nullif(trim(coalesce(v_item->>'description','')), ''),
      nullif(trim(coalesce(v_item->>'reference','')), ''),
      v_unit, v_price, v_tax, v_cost, v_margin
    ) returning id into v_service;

    insert into public.service_price_versions (
      organization_id, service_id, unit, unit_price, tax_rate, created_by
    ) values (p_org, v_service, v_unit, v_price, v_tax, auth.uid());
  end loop;

  perform public.audit_event(
    p_org, 'service_category.created', 'service_category', v_category, null,
    jsonb_build_object('name', trim(p_category_name),
      'services_count', jsonb_array_length(p_services))
  );
  return v_category;
end;
$function$;

create or replace function public.update_service_price(
  p_org uuid,
  p_service uuid,
  p_unit text,
  p_unit_price numeric,
  p_tax_rate numeric,
  p_effective_from timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_service public.services%rowtype;
  v_version uuid;
  v_allowed_units text[] := array[
    'forfait','unite','heure','demi_journee','jour','nuitee','semaine',
    'mois','annee','minute','seance','intervention','trajet','colis',
    'personne','dossier','m2'
  ];
begin
  perform public.assert_org_access(p_org);
  perform public.assert_org_permission(p_org, 'services.create');

  if p_unit is null or not (p_unit = any(v_allowed_units))
     or p_unit_price is null or p_unit_price < 0
     or p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 100
     or p_effective_from is null or p_effective_from > now() then
    raise exception 'Nouveau tarif ou unité invalide';
  end if;

  select * into v_service
  from public.services
  where id = p_service and organization_id = p_org and is_active
  for update;

  if not found then raise exception 'Prestation introuvable ou archivée'; end if;

  if exists (
    select 1 from public.service_price_versions
    where organization_id = p_org and service_id = p_service
      and effective_from >= p_effective_from
  ) then
    raise exception 'La date d’effet doit être postérieure aux versions existantes';
  end if;

  update public.service_price_versions
  set effective_until = p_effective_from
  where organization_id = p_org and service_id = p_service
    and effective_until is null;

  insert into public.service_price_versions (
    organization_id, service_id, unit, unit_price, tax_rate,
    effective_from, created_by
  ) values (
    p_org, p_service, p_unit, p_unit_price, p_tax_rate,
    p_effective_from, auth.uid()
  ) returning id into v_version;

  update public.services
  set unit = p_unit, unit_price = p_unit_price, tax_rate = p_tax_rate,
      updated_at = now()
  where id = p_service and organization_id = p_org;

  perform public.audit_event(
    p_org, 'service.price_updated', 'service', p_service,
    jsonb_build_object('unit', v_service.unit, 'unit_price', v_service.unit_price,
      'tax_rate', v_service.tax_rate),
    jsonb_build_object('unit', p_unit, 'unit_price', p_unit_price,
      'tax_rate', p_tax_rate, 'effective_from', p_effective_from,
      'price_version_id', v_version)
  );

  return v_version;
end;
$function$;

revoke all on function public.create_service_category_with_services(uuid,text,text,jsonb) from public, anon;
grant execute on function public.create_service_category_with_services(uuid,text,text,jsonb) to authenticated;
revoke all on function public.update_service_price(uuid,uuid,text,numeric,numeric,timestamptz) from public, anon;
grant execute on function public.update_service_price(uuid,uuid,text,numeric,numeric,timestamptz) to authenticated;
