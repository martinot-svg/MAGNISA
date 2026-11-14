-- MAGNISA registration origin: region + precise locality, kept PRIVATE.
-- Internal codes 901..924 denote regions, never invented codes for villages.
-- Existing geo mappings, opaque IDs, and the eight legacy codes remain untouched.
insert into private.magnisa_location_codes(country_code,locality_code,locality_name)
values
 ('261','901','Région : Alaotra-Mangoro'),
 ('261','902','Région : Ambatosoa'),
 ('261','903','Région : Amoron''i Mania'),
 ('261','904','Région : Analamanga'),
 ('261','905','Région : Analanjirofo'),
 ('261','906','Région : Androy'),
 ('261','907','Région : Anosy'),
 ('261','908','Région : Atsimo-Andrefana'),
 ('261','909','Région : Atsimo-Atsinanana'),
 ('261','910','Région : Atsinanana'),
 ('261','911','Région : Betsiboka'),
 ('261','912','Région : Boeny'),
 ('261','913','Région : Bongolava'),
 ('261','914','Région : DIANA'),
 ('261','915','Région : Fitovinany'),
 ('261','916','Région : Haute Matsiatra'),
 ('261','917','Région : Ihorombe'),
 ('261','918','Région : Itasy'),
 ('261','919','Région : Melaky'),
 ('261','920','Région : Menabe'),
 ('261','921','Région : SAVA'),
 ('261','922','Région : Sofia'),
 ('261','923','Région : Vakinankaratra'),
 ('261','924','Région : Vatovavy')
on conflict (country_code,locality_code) do nothing;

create table if not exists private.magnisa_declared_origin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  region_code text not null check (region_code ~ '^9(0[1-9]|1[0-9]|2[0-4])$'),
  locality_name text not null check (length(btrim(locality_name)) between 2 and 160),
  locality_ref text,
  commune_name text,
  district_name text,
  registered_at timestamptz not null default now()
);
alter table private.magnisa_declared_origin enable row level security;
revoke all on private.magnisa_declared_origin from public, anon, authenticated;

-- Server-only atomic origin attachment after Auth sign-up. No raw geo in JWT.
create or replace function public.register_magnisa_signup_location(
  p_user uuid, p_region_code text, p_locality_name text,
  p_locality_ref text, p_commune text, p_district text
) returns void language plpgsql security definer set search_path='' as $magnisa$
declare v_location text;
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  v_location := btrim(coalesce(p_locality_name,''));
  if length(v_location) not between 2 and 160 or
     p_region_code !~ '^9(0[1-9]|1[0-9]|2[0-4])$' or not exists(
       select 1 from private.magnisa_location_codes
        where country_code='261' and locality_code=p_region_code
          and locality_name like 'Région : %'
     ) then
    raise exception 'Localité ou région invalide' using errcode='22023';
  end if;
  if not exists (select 1 from public.profiles where id=p_user) then
    raise exception 'Utilisateur inexistant' using errcode='P0002';
  end if;
  perform private.magnisa_register_location(p_user,'261',p_region_code);
  if not exists (select 1 from private.magnisa_identity_mapping m
    where m.user_id=p_user and m.country_code='261' and m.locality_code=p_region_code) then
    raise exception 'Lieu d’inscription déjà fixé' using errcode='22023';
  end if;
  insert into private.magnisa_declared_origin(
    user_id,region_code,locality_name,locality_ref,commune_name,district_name
  ) values (
    p_user,p_region_code,v_location,nullif(btrim(p_locality_ref),''),
    nullif(btrim(p_commune),''),nullif(btrim(p_district),'')
  ) on conflict (user_id) do nothing;
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_location(uuid,text,text,text,text,text)
 from public, anon, authenticated;
grant execute on function public.register_magnisa_signup_location(uuid,text,text,text,text,text)
 to service_role;

-- Recovery for a user whose Auth account exists but registration was not attached.
-- Uses auth.uid() so nobody can claim another user's origin.
create or replace function public.claim_magnisa_identity_with_location(
  p_full_name text, p_username text, p_region_code text, p_locality_name text
) returns void language plpgsql security definer set search_path='' as $magnisa$
declare v_user uuid; v_locality text;
begin
  v_user := (select auth.uid());
  if v_user is null then raise exception 'Connexion requise' using errcode='28000'; end if;
  v_locality := btrim(coalesce(p_locality_name,''));
  if length(v_locality) not between 2 and 160 or
     p_region_code !~ '^9(0[1-9]|1[0-9]|2[0-4])$' then
    raise exception 'Localité ou région invalide' using errcode='22023';
  end if;
  perform public.claim_magnisa_identity(p_full_name,p_username,'261',p_region_code);
  if not exists (select 1 from private.magnisa_identity_mapping m
    where m.user_id=v_user and m.country_code='261' and m.locality_code=p_region_code) then
    raise exception 'Lieu d’inscription déjà fixé' using errcode='22023';
  end if;
  insert into private.magnisa_declared_origin(user_id,region_code,locality_name)
  values(v_user,p_region_code,v_locality)
  on conflict (user_id) do nothing;
end;
$magnisa$;
revoke all on function public.claim_magnisa_identity_with_location(text,text,text,text)
 from public, anon;
grant execute on function public.claim_magnisa_identity_with_location(text,text,text,text)
 to authenticated;

comment on table private.magnisa_declared_origin is
 'Confidential immutable registration origin: user-declared locality, optional validated suggestion and region. No anon/authenticated access.';
