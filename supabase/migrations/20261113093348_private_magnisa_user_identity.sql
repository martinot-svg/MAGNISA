-- MAGNISA: public 14-digit opaque IDs and confidential registration origin.
-- Public UUID keys remain unchanged; no salary, accounting or membership migration.
create schema if not exists private;
-- Preserve pre-existing schema USAGE required by MAGNISA accounting and stock RPCs.
-- New identity tables below have no authenticated/anon table privileges.
create sequence if not exists private.magnisa_registration_number_seq
  as bigint start with 1 increment by 1 minvalue 1 maxvalue 99999999 no cycle;

create table if not exists private.magnisa_location_codes (
  country_code text not null check (country_code ~ '^[0-9]{3}$'),
  locality_code text not null check (locality_code ~ '^[0-9]{3}$'),
  locality_name text not null,
  primary key (country_code, locality_code)
);
insert into private.magnisa_location_codes(country_code,locality_code,locality_name) values
 ('261','101','Antananarivo'),('261','110','Antsirabe'),
 ('261','201','Antsiranana'),('261','301','Fianarantsoa'),
 ('261','401','Mahajanga'),('261','501','Toamasina'),
 ('261','601','Toliara I'),('261','602','Toliara II')
on conflict do nothing;

create table if not exists private.magnisa_identity_mapping (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country_code text not null,
  locality_code text not null,
  registration_number bigint not null unique check (registration_number between 1 and 99999999),
  geographic_identity text not null unique check (geographic_identity ~ '^[0-9]{14}$'),
  registered_at timestamptz not null default now(),
  foreign key (country_code,locality_code) references private.magnisa_location_codes(country_code,locality_code)
);
alter table private.magnisa_location_codes enable row level security;
alter table private.magnisa_identity_mapping enable row level security;
revoke all on private.magnisa_location_codes, private.magnisa_identity_mapping from public, anon, authenticated;
revoke all on sequence private.magnisa_registration_number_seq from public, anon, authenticated;

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists username text,
  add column if not exists username_changed_at timestamptz,
  add column if not exists public_id text;
alter table public.profiles drop constraint if exists magnisa_profile_username_format;
alter table public.profiles add constraint magnisa_profile_username_format
  check (username is null or username ~ '^[a-z][a-z0-9._]{2,29}$');
alter table public.profiles drop constraint if exists magnisa_profile_public_id_format;
alter table public.profiles add constraint magnisa_profile_public_id_format
  check (public_id is null or public_id ~ '^[0-9]{14}$');
alter table public.profiles drop constraint if exists magnisa_profile_full_name_length;
alter table public.profiles add constraint magnisa_profile_full_name_length
  check (full_name is null or length(btrim(full_name)) between 2 and 120);
create unique index if not exists magnisa_profiles_username_unique
  on public.profiles (username) where username is not null;
create unique index if not exists magnisa_profiles_public_id_unique
  on public.profiles (public_id) where public_id is not null;

-- Keep issued numbers reserved forever, even after account deletion.
create table if not exists private.magnisa_public_id_registry (
  public_id text primary key check (public_id ~ '^[0-9]{14}$'),
  issued_at timestamptz not null default now()
);
alter table private.magnisa_public_id_registry enable row level security;
revoke all on private.magnisa_public_id_registry from public, anon, authenticated;

-- The 14-digit external identifier is random. The public number neither embeds
-- the geographic prefix nor reveals the registration sequence.
create or replace function private.magnisa_random_public_id()
returns text language plpgsql volatile security definer
set search_path = '' as $magnisa$
declare v_hex text; v_num bigint; v_id text; v_attempt integer; v_byte integer;
begin
  for v_attempt in 1..12 loop
    v_hex := replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_num := 0;
    for v_byte in 0..5 loop
      v_num := v_num*256 + pg_catalog.get_byte(pg_catalog.decode(substr(v_hex,1,12),'hex'), v_byte);
    end loop;
    v_num := (v_num % 90000000000000) + 10000000000000;
    v_id := v_num::text;
    insert into private.magnisa_public_id_registry(public_id) values (v_id)
      on conflict do nothing;
    if found then return v_id; end if;
  end loop;
  raise exception 'Impossible de générer un identifiant utilisateur unique';
end;
$magnisa$;

create or replace function private.magnisa_register_location(p_user uuid, p_country text, p_locality text)
returns void language plpgsql security definer set search_path = '' as $magnisa$
declare v_n bigint;
begin
  if not exists (select 1 from private.magnisa_location_codes
                 where country_code=p_country and locality_code=p_locality) then
    raise exception 'Lieu d’inscription non reconnu' using errcode='22023';
  end if;
  if exists (select 1 from private.magnisa_identity_mapping where user_id=p_user) then
    return; -- Geographic identity is permanent; never overwrite a chosen origin.
  end if;
  v_n := nextval('private.magnisa_registration_number_seq'::regclass);
  insert into private.magnisa_identity_mapping
    (user_id,country_code,locality_code,registration_number,geographic_identity)
  values (p_user,p_country,p_locality,v_n,p_country||p_locality||lpad(v_n::text,8,'0'))
  on conflict (user_id) do nothing;
end;
$magnisa$;

create or replace function private.magnisa_issue_profile_id()
returns trigger language plpgsql security definer set search_path = '' as $magnisa$
declare v_meta jsonb; v_name text; v_username text;
        v_id text; v_attempt integer;
begin
  select coalesce(raw_user_meta_data, '{}'::jsonb) into v_meta
    from auth.users where id=new.id;
  v_name := btrim(coalesce(v_meta->>'full_name',''));
  v_username := lower(btrim(coalesce(v_meta->>'username','')));
  -- The country/locality are NEVER stored in user_metadata, which is visible
  -- to the user through Supabase Auth. Registration uses a private RPC instead.

  -- Assign an opaque ID even for invitations and pre-existing accounts.
  for v_attempt in 1..8 loop
    v_id := private.magnisa_random_public_id();
    begin
      update public.profiles set public_id=v_id where id=new.id and public_id is null;
      exit;
    exception when unique_violation then
      if v_attempt=8 then raise; end if;
    end;
  end loop;
  if length(v_name) between 2 and 120 and v_username ~ '^[a-z][a-z0-9._]{2,29}$' then
    update public.profiles set full_name=v_name,username=v_username,
      username_changed_at=now() where id=new.id;
  end if;

  return new;
end;
$magnisa$;

drop trigger if exists magnisa_profile_issue_id on public.profiles;
create trigger magnisa_profile_issue_id after insert on public.profiles
for each row execute function private.magnisa_issue_profile_id();

-- Add opaque IDs to legacy users without guessing their birthplace/locality.
do $magnisa$
declare p record; v_attempt integer;
begin
  for p in select id from public.profiles where public_id is null order by created_at,id loop
    for v_attempt in 1..8 loop
      begin
        update public.profiles set public_id=private.magnisa_random_public_id() where id=p.id;
        exit;
      exception when unique_violation then
        if v_attempt=8 then raise; end if;
      end;
    end loop;
  end loop;
end $magnisa$;

-- The authenticated user can only claim/update their own username and their
-- immutable registration origin. RLS is not used as a shortcut to other profiles.
create or replace function public.claim_magnisa_identity(
  p_full_name text, p_username text, p_country text, p_locality text
) returns void language plpgsql security definer
set search_path = '' as $magnisa$
declare v_user uuid; v_existing text; v_changed timestamptz; v_name text; v_username text;
begin
  v_user := (select auth.uid());
  if v_user is null then
    raise exception 'Connexion requise' using errcode='28000';
  end if;
  v_name := btrim(coalesce(p_full_name,''));
  v_username := lower(btrim(coalesce(p_username,'')));
  if length(v_name) not between 2 and 120 then
    raise exception 'Nom complet invalide' using errcode='22023';
  end if;
  if v_username !~ '^[a-z][a-z0-9._]{2,29}$' then
    raise exception 'Nom utilisateur invalide' using errcode='22023';
  end if;
  select username,username_changed_at into v_existing,v_changed
    from public.profiles where id=v_user for update;
  if not found then
    raise exception 'Profil indisponible' using errcode='P0002';
  end if;
  if v_existing is distinct from v_username and v_existing is not null
     and v_changed > now()-interval '30 days' then
    raise exception 'Modification du nom utilisateur limitée à une fois tous les 30 jours'
      using errcode='22023';
  end if;
  update public.profiles set full_name=v_name,username=v_username,
    username_changed_at=case when v_existing is distinct from v_username then now() else v_changed end,
    updated_at=now() where id=v_user;
  if not exists (select 1 from private.magnisa_identity_mapping where user_id=v_user) then
    perform private.magnisa_register_location(v_user,p_country,p_locality);
  end if;
exception when unique_violation then
  raise exception 'Ce nom utilisateur est déjà utilisé' using errcode='23505';
end;
$magnisa$;
revoke all on function public.claim_magnisa_identity(text,text,text,text) from public,anon;
grant execute on function public.claim_magnisa_identity(text,text,text,text) to authenticated;
revoke all on function private.magnisa_random_public_id() from public,anon,authenticated;
revoke all on function private.magnisa_register_location(uuid,text,text) from public,anon,authenticated;
revoke all on function private.magnisa_issue_profile_id() from public,anon,authenticated;

-- Server-side signup completion: only service_role may attach the private
-- geographic identity to a newly created Supabase Auth user. No location codes
-- are ever placed in raw_user_meta_data / JWT claims / client profiles.
create or replace function public.register_magnisa_signup_origin(
  p_user uuid, p_country text, p_locality text
) returns void language plpgsql security definer set search_path='' as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if not exists (select 1 from public.profiles where id=p_user) then
    raise exception 'Utilisateur inexistant' using errcode='P0002';
  end if;
  perform private.magnisa_register_location(p_user,p_country,p_locality);
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_origin(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_magnisa_signup_origin(uuid,text,text) to service_role;

-- Only the existence of an immutable registration may be seen by that user.
create or replace function public.has_magnisa_registration()
returns boolean language sql stable security definer set search_path = '' as $magnisa$
  select (select auth.uid()) is not null and exists (
    select 1 from private.magnisa_identity_mapping where user_id=(select auth.uid())
  );
$magnisa$;
revoke all on function public.has_magnisa_registration() from public,anon;
grant execute on function public.has_magnisa_registration() to authenticated;

-- No organization owner is implicitly a platform owner. The platform allowlist
-- is intentionally empty until the real platform owner is securely identified.
create table if not exists private.magnisa_platform_identity_owners(
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table private.magnisa_platform_identity_owners enable row level security;
revoke all on private.magnisa_platform_identity_owners from public,anon,authenticated;

-- Server-side directory: only an explicitly enrolled platform owner with MFA
-- may retrieve origin mapping; company owners/admins have NO inherited right.
create or replace function public.magnisa_platform_origin_directory()
returns table (user_public_id text, username text, origin_country text,
               origin_locality text, registration_number bigint, registered_at timestamptz)
language plpgsql stable security definer set search_path = '' as $magnisa$
begin
  if (select auth.uid()) is null or not exists(
    select 1 from private.magnisa_platform_identity_owners where user_id=(select auth.uid())
  ) then
    raise exception 'Accès réservé au propriétaire de la plateforme' using errcode='42501';
  end if;
  if coalesce((select auth.jwt())->>'aal','') <> 'aal2' then
    raise exception 'Authentification multifacteur requise' using errcode='42501';
  end if;
  return query select p.public_id,p.username,m.country_code,m.locality_code,
       m.registration_number,m.registered_at
    from private.magnisa_identity_mapping m
    join public.profiles p on p.id=m.user_id
    order by m.registration_number;
end;
$magnisa$;
revoke all on function public.magnisa_platform_origin_directory() from public,anon;
grant execute on function public.magnisa_platform_origin_directory() to authenticated;

-- Login throttling: called by service_role only, keyed with server HMAC (no raw IP).
create table if not exists private.magnisa_username_login_limits(
  fingerprint text primary key check (length(fingerprint)=64),
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);
alter table private.magnisa_username_login_limits enable row level security;
revoke all on private.magnisa_username_login_limits from public,anon,authenticated;
create or replace function public.consume_magnisa_username_login_attempt(p_fingerprint text)
returns boolean language plpgsql security definer set search_path = '' as $magnisa$
declare v_attempts integer;
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    return false;
  end if;
  if p_fingerprint !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into private.magnisa_username_login_limits(fingerprint,window_start,attempts)
    values(p_fingerprint,now(),1)
  on conflict(fingerprint) do update set
    window_start=case when private.magnisa_username_login_limits.window_start < now()-interval '15 minutes'
      then now() else private.magnisa_username_login_limits.window_start end,
    attempts=case when private.magnisa_username_login_limits.window_start < now()-interval '15 minutes'
      then 1 else private.magnisa_username_login_limits.attempts+1 end
  returning attempts into v_attempts;
  return v_attempts<=10;
end;
$magnisa$;
revoke all on function public.consume_magnisa_username_login_attempt(text) from public,anon,authenticated;
grant execute on function public.consume_magnisa_username_login_attempt(text) to service_role;

-- Owner-only mapping stays in a non-exposed private schema, never included
-- in client APIs, organization member lists or normal profile queries.
comment on table private.magnisa_identity_mapping is
 'Highly confidential registration origin mapping. No anon/authenticated grants. Assign platform-owner access separately after identity verification.';
