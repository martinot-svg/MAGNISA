-- MAGNISA: generate new usernames from given and family names (max 10 ASCII letters).
-- Forward-only: preserve old usernames, existing login aliases, public IDs, and account UUIDs.
-- No modifications to geography, payroll, accounting, or membership authorizations.

-- Old usernames (3-30 chars) stay valid. New automatic usernames may have 2 chars.
alter table public.profiles drop constraint if exists magnisa_profile_username_format;
alter table public.profiles add constraint magnisa_profile_username_format
  check (username is null or username ~ '^[a-z][a-z0-9._]{1,29}$');

-- Concurrency-safe allocation: serialize generators in their transaction,
-- then rely on the unique index already installed on public.profiles.username.
create or replace function private.magnisa_generate_username(p_full_name text)
returns text language plpgsql volatile security definer set search_path=''
as $username$
declare
  v_base text;
  v_candidate text;
  v_suffix text;
  v_counter integer;
  v_index integer;
begin
  v_base := pg_catalog.lower(pg_catalog.btrim(coalesce(p_full_name,'')));
  v_base := pg_catalog.replace(v_base,'œ','oe');
  v_base := pg_catalog.replace(v_base,'æ','ae');
  v_base := pg_catalog.replace(v_base,'ß','ss');
  v_base := pg_catalog.translate(
    v_base,'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy');
  v_base := pg_catalog.regexp_replace(v_base,'[^a-z]','','g');
  if pg_catalog.length(v_base)<2 then
    raise exception 'Prénoms et nom insuffisants pour générer le nom utilisateur'
      using errcode='22023';
  end if;
  v_base := pg_catalog.substr(v_base,1,10);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('magnisa-global-username-allocation',0));
  for v_index in 0..50000 loop
    if v_index=0 then
      v_candidate := v_base;
    else
      v_counter := v_index;
      v_suffix := '';
      while v_counter>0 loop
        v_suffix := chr(97+((v_counter-1)%26)) || v_suffix;
        v_counter := (v_counter-1)/26;
      end loop;
      if pg_catalog.length(v_suffix)>8 then
        exit;
      end if;
      v_candidate := pg_catalog.substr(v_base,1,10-pg_catalog.length(v_suffix)) || v_suffix;
    end if;
    if v_candidate ~ '^[a-z]{2,10}$' and not exists (
      select 1 from public.profiles p where p.username=v_candidate
    ) then
      return v_candidate;
    end if;
  end loop;
  raise exception 'Aucun nom utilisateur disponible pour cette identité'
    using errcode='54000';
end;
$username$;
revoke all on function private.magnisa_generate_username(text) from public,anon,authenticated;

-- Applies to every new Auth user with a full name, not only the signup screen.
-- Legacy admin-created accounts passing an explicit valid alias retain it,
-- preserving test fixtures and pre-existing integration contracts.
create or replace function private.magnisa_issue_profile_id()
returns trigger language plpgsql security definer set search_path=''
as $username$
declare
  v_meta jsonb;
  v_name text;
  v_username text;
  v_id text;
  v_attempt integer;
begin
  select coalesce(raw_user_meta_data,'{}'::jsonb) into v_meta
    from auth.users where id=new.id;
  v_name := pg_catalog.btrim(coalesce(v_meta->>'full_name',''));
  v_username := pg_catalog.lower(pg_catalog.btrim(coalesce(v_meta->>'username','')));

  for v_attempt in 1..8 loop
    v_id := private.magnisa_random_public_id();
    begin
      update public.profiles set public_id=v_id
        where id=new.id and public_id is null;
      exit;
    exception when unique_violation then
      if v_attempt=8 then raise; end if;
    end;
  end loop;

  if pg_catalog.length(v_name) between 2 and 120 then
    if v_username !~ '^[a-z][a-z0-9._]{2,29}$' then
      v_username := private.magnisa_generate_username(v_name);
    end if;
    update public.profiles
      set full_name=v_name, username=v_username, username_changed_at=now()
      where id=new.id;
  end if;
  return new;
end;
$username$;

-- Username edits remain possible after the existing 30-day cooldown,
-- but any newly claimed/renamed alias must be 2-10 lowercase letters.
-- When none exists, the DB generates one; clients cannot choose an initial alias.
create or replace function public.claim_magnisa_identity(
  p_full_name text,p_username text,p_country text,p_locality text
) returns void language plpgsql security definer set search_path=''
as $username$
declare
  v_user uuid;
  v_existing text;
  v_changed timestamptz;
  v_name text;
  v_username text;
begin
  v_user := (select auth.uid());
  if v_user is null then
    raise exception 'Connexion requise' using errcode='28000';
  end if;
  v_name := pg_catalog.btrim(coalesce(p_full_name,''));
  if pg_catalog.length(v_name) not between 2 and 120 then
    raise exception 'Nom complet invalide' using errcode='22023';
  end if;
  select username,username_changed_at into v_existing,v_changed
    from public.profiles where id=v_user for update;
  if not found then
    raise exception 'Profil indisponible' using errcode='P0002';
  end if;
  if v_existing is null then
    v_username := private.magnisa_generate_username(v_name);
  else
    v_username := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username,'')));
    if v_username='' then v_username:=v_existing; end if;
    if v_username is distinct from v_existing then
      if v_username !~ '^[a-z]{2,10}$' then
        raise exception 'Le nom utilisateur doit contenir au maximum 10 lettres'
          using errcode='22023';
      end if;
      if v_changed>now()-interval '30 days' then
        raise exception 'Modification du nom utilisateur limitée à une fois tous les 30 jours'
          using errcode='22023';
      end if;
    end if;
  end if;

  update public.profiles set
    full_name=v_name,
    username=v_username,
    username_changed_at=case when v_existing is distinct from v_username then now() else v_changed end,
    updated_at=now()
  where id=v_user;

  if not exists (select 1 from private.magnisa_identity_mapping where user_id=v_user) then
    perform private.magnisa_register_location(v_user,p_country,p_locality);
  end if;
exception when unique_violation then
  raise exception 'Ce nom utilisateur est déjà utilisé' using errcode='23505';
end;
$username$;

revoke all on function public.claim_magnisa_identity(text,text,text,text) from public,anon;
grant execute on function public.claim_magnisa_identity(text,text,text,text) to authenticated;

-- Backfill only missing usernames when a name was explicitly supplied.
-- Never infer names from email addresses or change existing usernames.
do $username$
declare v_profile record;
begin
  for v_profile in
    select id,full_name from public.profiles
    where username is null and pg_catalog.length(pg_catalog.btrim(coalesce(full_name,''))) between 2 and 120
    order by created_at,id
  loop
    update public.profiles
      set username=private.magnisa_generate_username(v_profile.full_name),
          username_changed_at=now()
      where id=v_profile.id and username is null;
  end loop;
end;
$username$;
