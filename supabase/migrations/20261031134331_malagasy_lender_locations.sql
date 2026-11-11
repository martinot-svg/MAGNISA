create table if not exists public.financial_institution_locations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid references public.organizations(id) on delete cascade,
 institution_id uuid not null references public.financial_institutions(id) on delete cascade,
 branch_name text not null check(length(btrim(branch_name)) between 2 and 160),
 city text not null check(length(btrim(city)) between 2 and 120),
 region text,
 address text,
 location_type text not null default 'agency' check(location_type in ('agency','headquarters','business_center','service_point')),
 is_active boolean not null default true,
 verification_status text not null default 'reference' check(verification_status in ('verified','reference','user_added','needs_review')),
 source_url text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists financial_institution_locations_lookup_idx on public.financial_institution_locations(institution_id, lower(city), is_active);
create unique index if not exists financial_institution_locations_global_unique on public.financial_institution_locations(institution_id, lower(city), lower(branch_name)) where organization_id is null;
create unique index if not exists financial_institution_locations_org_unique on public.financial_institution_locations(organization_id, institution_id, lower(city), lower(branch_name)) where organization_id is not null;
alter table public.loans add column if not exists lender_location_id uuid references public.financial_institution_locations(id) on delete set null, add column if not exists lender_city text, add column if not exists lender_region text, add column if not exists lender_branch_name text, add column if not exists lender_address text;
alter table public.financial_institution_locations enable row level security;
drop policy if exists financial_institution_locations_read on public.financial_institution_locations;
create policy financial_institution_locations_read on public.financial_institution_locations for select to authenticated using (organization_id is null or public.has_org_permission(organization_id,'finance.view'));
drop policy if exists financial_institution_locations_insert on public.financial_institution_locations;
create policy financial_institution_locations_insert on public.financial_institution_locations for insert to authenticated with check (organization_id is not null and public.has_org_permission(organization_id,'treasury.transfer'));
drop policy if exists financial_institution_locations_update on public.financial_institution_locations;
create policy financial_institution_locations_update on public.financial_institution_locations for update to authenticated using (organization_id is not null and public.has_org_permission(organization_id,'treasury.transfer')) with check (organization_id is not null and public.has_org_permission(organization_id,'treasury.transfer'));
drop policy if exists financial_institution_locations_delete on public.financial_institution_locations;
create policy financial_institution_locations_delete on public.financial_institution_locations for delete to authenticated using (organization_id is not null and public.has_org_permission(organization_id,'treasury.transfer'));
grant select,insert,update,delete on public.financial_institution_locations to authenticated;
insert into public.financial_institution_locations(institution_id,branch_name,city,region,address,location_type,source_url)
select fi.id,v.branch_name,v.city,v.region,v.address,v.location_type,v.source_url
from (values
 ('BMOI','Agence et GAB BMOI Toliara','Toliara','Atsimo-Andrefana','Angle rue Fayelle et rue Faray','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Siège Succursale Antaninarenina','Antananarivo','Analamanga','Place de l’Indépendance, Antaninarenina','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI By Pass','Antananarivo','Analamanga','Lot 113 XA, Bypass, Ankadindratombo','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Galaxy','Antananarivo','Analamanga','Kube D Galaxy, Andraharo','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Tanjombato','Antananarivo','Analamanga','Riviera Tanjombato','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Antsirabe','Antsirabe','Vakinankaratra','Lot 22K 10, Tsarasaotra','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Diégo','Antsiranana','Diana','54, rue Colbert','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Mahajanga','Mahajanga','Boeny','Lot 0101 DL 0020, Mahajanga Be','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Nosy Be','Nosy Be','Diana','Angle rue Passot et Cour d’Hell, Hell-Ville','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Sambava','Sambava','Sava','52, rue du Commerce','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Tamatave Augagneur','Toamasina','Atsinanana','Enceinte BATPRO, boulevard Augagneur','agency','https://www.bmoi.mg/localisation/'),
 ('BMOI','Agence et GAB BMOI Tamatave Joffre','Toamasina','Atsinanana','Angle rue Lieutenant Emmanuel Bérard et boulevard Joffre','agency','https://www.bmoi.mg/localisation/'),
 ('BGFIBank Madagascar','Agence Ankorondrano','Antananarivo','Analamanga','Immeuble ATRIUM','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Agence Antaninarenina','Antananarivo','Analamanga','Près de ROXY, Antaninarenina','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Agence Tamatave','Toamasina','Atsinanana','Avenue de l’Indépendance, SUPER U','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Centre d’affaires Tamatave','Toamasina','Atsinanana','Enceinte ABC Tamatave','business_center','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Agence Sambava','Sambava','Sava','Centre commercial TANDRAMENA','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Agence Ambanja','Ambanja','Diana','Ankatafahely Centre','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('BGFIBank Madagascar','Agence Ambilobe','Ambilobe','Diana','Immeuble KOZOBE','agency','https://madagascar.bgfi.com/nos-agences/'),
 ('NIM','Agence Antananarivo','Antananarivo','Analamanga',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Fianarantsoa','Fianarantsoa','Haute Matsiatra',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Ambalavao','Ambalavao','Haute Matsiatra',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Ihosy','Ihosy','Ihorombe',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Manakara','Manakara','Fitovinany',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Mananjary','Mananjary','Vatovavy',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Toamasina','Toamasina','Atsinanana',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Andapa','Andapa','Sava',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Antsirabe','Antsirabe','Vakinankaratra',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Sambava','Sambava','Sava',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Toliara','Toliara','Atsimo-Andrefana',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Mahajanga','Mahajanga','Boeny',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Antsiranana','Antsiranana','Diana',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Ambatolampy','Ambatolampy','Vakinankaratra',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Vangaindrano','Vangaindrano','Atsimo-Atsinanana',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Ambositra','Ambositra','Amoron’i Mania',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Amparafaravola','Amparafaravola','Alaotra-Mangoro',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Miandrivazo','Miandrivazo','Menabe',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Analavory','Analavory','Itasy',null,'agency','https://nim.mg/about-us/'),
 ('NIM','Agence Fort-Dauphin','Fort-Dauphin','Anosy',null,'agency','https://nim.mg/about-us/'),
 ('SIPEM Banque','Siège SIPEM Banque','Antananarivo','Analamanga','Lot A 216 H, Andavamamba','headquarters','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Mahajanga','Mahajanga','Boeny','Lot 17 F, Secteur III, Fiofio','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Tsaramandroso','Mahajanga','Boeny','Lot 01 07 F 0100 B, Mahavoky Sud secteur VI','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Toamasina Tanambao','Toamasina','Atsinanana','Lot 22, Cité PROCOOPS, Tanambao V','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Toamasina Ankirihiry','Toamasina','Atsinanana','Lot 69 AK, Carreau 10 A 250, Ankirihiry Nord','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Toliara','Toliara','Atsimo-Andrefana','Immeuble Tropical Hôtel','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Tsaramandroso Antsiranana','Antsiranana','Diana','Lot 18RA','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Ambatoloaka','Nosy Be','Diana','La Vitrine, Pavillon n°4, Andranotsimaiky','agency','https://www.sipembanque.mg/nos-agences/'),
 ('SIPEM Banque','Agence Ambatondrazaka','Ambatondrazaka','Alaotra-Mangoro','Lot 22 100, Madiotsifafana','agency','https://www.sipembanque.mg/nos-agences/')
) as v(institution,branch_name,city,region,address,location_type,source_url)
join public.financial_institutions fi on fi.display_name=v.institution and fi.organization_id is null and fi.country_code='MG'
on conflict do nothing;
