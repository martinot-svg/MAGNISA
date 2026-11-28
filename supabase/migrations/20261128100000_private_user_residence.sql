-- MAGNISA: residence is distinct from immutable registration origin.
create table if not exists private.magnisa_user_residence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country_iso2 text not null check (country_iso2 ~ '^[A-Z]{2}$'),
  country_name text not null check (length(btrim(country_name)) between 2 and 100),
  region_name text not null check (length(btrim(region_name)) between 1 and 120),
  locality_name text not null check (length(btrim(locality_name)) between 2 and 160),
  locality_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.magnisa_user_residence enable row level security;
revoke all on private.magnisa_user_residence from public, anon, authenticated;

create or replace function public.register_magnisa_signup_residence(
  p_user uuid, p_country_iso2 text, p_country_name text,
  p_region_name text, p_locality_name text, p_locality_ref text default null
) returns void language plpgsql security definer set search_path='' as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if p_country_iso2 !~ '^[A-Z]{2}$'
     or length(btrim(coalesce(p_country_name,''))) not between 2 and 100
     or length(btrim(coalesce(p_region_name,''))) not between 1 and 120
     or length(btrim(coalesce(p_locality_name,''))) not between 2 and 160
     or length(coalesce(p_locality_ref,'')) > 40 then
    raise exception 'Informations de résidence invalides' using errcode='22023';
  end if;
  if not exists (select 1 from public.profiles where id=p_user) then
    raise exception 'Utilisateur inexistant' using errcode='P0002';
  end if;
  insert into private.magnisa_user_residence(
    user_id,country_iso2,country_name,region_name,locality_name,locality_ref
  ) values (
    p_user,p_country_iso2,btrim(p_country_name),btrim(p_region_name),
    btrim(p_locality_name),nullif(btrim(coalesce(p_locality_ref,'')),'')
  )
  on conflict(user_id) do update set
    country_iso2=excluded.country_iso2,
    country_name=excluded.country_name,
    region_name=excluded.region_name,
    locality_name=excluded.locality_name,
    locality_ref=excluded.locality_ref,
    updated_at=now();
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_residence(uuid,text,text,text,text,text)
 from public, anon, authenticated;
grant execute on function public.register_magnisa_signup_residence(uuid,text,text,text,text,text)
 to service_role;

create or replace function public.get_magnisa_user_residence()
returns table(country_iso2 text,country_name text,region_name text,
              locality_name text,locality_ref text,updated_at timestamptz)
language sql stable security definer set search_path='' as $magnisa$
  select r.country_iso2,r.country_name,r.region_name,r.locality_name,
         r.locality_ref,r.updated_at
    from private.magnisa_user_residence r
   where r.user_id=(select auth.uid());
$magnisa$;
revoke all on function public.get_magnisa_user_residence() from public,anon;
grant execute on function public.get_magnisa_user_residence() to authenticated;

create or replace function public.update_magnisa_user_residence(
  p_country_iso2 text,p_country_name text,p_region_name text,
  p_locality_name text,p_locality_ref text default null
) returns void language plpgsql security definer set search_path='' as $magnisa$
declare v_user uuid;
begin
  v_user := (select auth.uid());
  if v_user is null then raise exception 'Connexion requise' using errcode='28000'; end if;
  if p_country_iso2 !~ '^[A-Z]{2}$'
     or length(btrim(coalesce(p_country_name,''))) not between 2 and 100
     or length(btrim(coalesce(p_region_name,''))) not between 1 and 120
     or length(btrim(coalesce(p_locality_name,''))) not between 2 and 160
     or length(coalesce(p_locality_ref,'')) > 40 then
    raise exception 'Informations de résidence invalides' using errcode='22023';
  end if;
  insert into private.magnisa_user_residence(
    user_id,country_iso2,country_name,region_name,locality_name,locality_ref
  ) values (
    v_user,p_country_iso2,btrim(p_country_name),btrim(p_region_name),
    btrim(p_locality_name),nullif(btrim(coalesce(p_locality_ref,'')),'')
  )
  on conflict(user_id) do update set
    country_iso2=excluded.country_iso2,
    country_name=excluded.country_name,
    region_name=excluded.region_name,
    locality_name=excluded.locality_name,
    locality_ref=excluded.locality_ref,
    updated_at=now();
end;
$magnisa$;
revoke all on function public.update_magnisa_user_residence(text,text,text,text,text)
 from public, anon;
grant execute on function public.update_magnisa_user_residence(text,text,text,text,text)
 to authenticated;


create or replace function public.get_magnisa_signup_residence_for_service(p_user uuid)
returns table(country_iso2 text,country_name text,region_name text,
              locality_name text,locality_ref text)
language plpgsql stable security definer set search_path='' as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  return query select r.country_iso2,r.country_name,r.region_name,
                      r.locality_name,r.locality_ref
    from private.magnisa_user_residence r where r.user_id=p_user;
end;
$magnisa$;
revoke all on function public.get_magnisa_signup_residence_for_service(uuid)
 from public, anon, authenticated;
grant execute on function public.get_magnisa_signup_residence_for_service(uuid)
 to service_role;

comment on table private.magnisa_user_residence is
 'User-editable residence data, separate from immutable private registration origin. No direct API table access.';
