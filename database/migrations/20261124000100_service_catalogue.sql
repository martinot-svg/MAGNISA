-- MAGNISA / Catalogue des prestations
-- Extension additive : ne modifie aucune table existante.
-- IMPORTANT : adapter la RLS à la vraie table de membres/permissions entreprise
-- avant d'ouvrir l'accès à plusieurs collaborateurs d'une même entreprise.

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  description text,
  color text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_name_not_blank check (length(trim(name)) > 0),
  constraint service_categories_company_name_unique unique (company_id, name)
);

create table if not exists public.service_catalogue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  category_id uuid not null references public.service_categories(id) on delete restrict,
  code text,
  name text not null,
  description text,
  unit_code text not null,
  unit_label text not null,
  unit_price_mga numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_catalogue_name_not_blank check (length(trim(name)) > 0),
  constraint service_catalogue_price_nonnegative check (unit_price_mga >= 0),
  constraint service_catalogue_vat_range check (vat_rate >= 0 and vat_rate <= 100),
  constraint service_catalogue_unit_code_check check (
    unit_code in ('HOUR', 'NIGHT', 'DAY', 'HALF_DAY', 'WEEK', 'MONTH', 'PACKAGE')
  ),
  constraint service_catalogue_company_code_unique unique (company_id, code)
);

create index if not exists idx_service_categories_company_active
  on public.service_categories(company_id, is_active);

create index if not exists idx_service_catalogue_company_category
  on public.service_catalogue(company_id, category_id);

create index if not exists idx_service_catalogue_company_active
  on public.service_catalogue(company_id, is_active);

create or replace function public.set_service_catalogue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_service_categories_updated_at on public.service_categories;
create trigger trg_service_categories_updated_at
before update on public.service_categories
for each row execute function public.set_service_catalogue_updated_at();

drop trigger if exists trg_service_catalogue_updated_at on public.service_catalogue;
create trigger trg_service_catalogue_updated_at
before update on public.service_catalogue
for each row execute function public.set_service_catalogue_updated_at();

alter table public.service_categories enable row level security;
alter table public.service_catalogue enable row level security;

drop policy if exists service_categories_select_owner on public.service_categories;
create policy service_categories_select_owner on public.service_categories
for select to authenticated using (created_by = auth.uid());

drop policy if exists service_categories_insert_owner on public.service_categories;
create policy service_categories_insert_owner on public.service_categories
for insert to authenticated with check (created_by = auth.uid());

drop policy if exists service_categories_update_owner on public.service_categories;
create policy service_categories_update_owner on public.service_categories
for update to authenticated using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists service_catalogue_select_owner on public.service_catalogue;
create policy service_catalogue_select_owner on public.service_catalogue
for select to authenticated using (created_by = auth.uid());

drop policy if exists service_catalogue_insert_owner on public.service_catalogue;
create policy service_catalogue_insert_owner on public.service_catalogue
for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.service_categories c
    where c.id = category_id
      and c.company_id = service_catalogue.company_id
      and c.created_by = auth.uid()
  )
);

drop policy if exists service_catalogue_update_owner on public.service_catalogue;
create policy service_catalogue_update_owner on public.service_catalogue
for update to authenticated using (created_by = auth.uid())
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.service_categories c
    where c.id = category_id
      and c.company_id = service_catalogue.company_id
      and c.created_by = auth.uid()
  )
);

-- Pas de DELETE : désactivation logique recommandée pour préserver l'historique.
