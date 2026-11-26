-- MAGNISA: honor selected signup usernames and enforce 3-10 letters for new aliases.
-- Existing usernames, public IDs, account UUIDs and login compatibility are preserved.
-- The existing broad profile constraint is intentionally retained for legacy accounts.

create or replace function private.magnisa_generate_username(
  p_given_names text, p_family_name text default null
)
returns text language plpgsql volatile security definer set search_path=''
as $username$
declare
  v_first text;
  v_last text;
  v_base text;
  v_candidate text;
  v_suffix text;
  v_counter integer;
  v_index integer;
begin
  v_first := pg_catalog.lower(pg_catalog.btrim(coalesce(p_given_names,'')));
  v_last := pg_catalog.lower(pg_catalog.btrim(coalesce(p_family_name,'')));
  if v_last='' and pg_catalog.strpos(v_first,' ')>0 then
    v_last := pg_catalog.btrim(pg_catalog.substr(v_first, pg_catalog.strpos(v_first,' ')+1));
    v_first := pg_catalog.split_part(v_first,' ',1);
  end if;
  v_first := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_first,'œ','oe'),'æ','ae'),'ß','ss');
  v_last := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_last,'œ','oe'),'æ','ae'),'ß','ss');
  v_first := pg_catalog.regexp_replace(
    pg_catalog.translate(v_first,'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z]','','g');
  v_last := pg_catalog.regexp_replace(
    pg_catalog.translate(v_last,'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z]','','g');
  v_base := pg_catalog.substr(v_first,1,case when pg_catalog.length(v_last)>0 then 9 else 10 end);
  v_base := v_base || pg_catalog.substr(v_last,1,10-pg_catalog.length(v_base));
  if pg_catalog.length(v_base)=1 then
    v_base := v_base || 'ma';
  elsif pg_catalog.length(v_base)=2 then
    v_base := v_base || 'm';
  end if;
  if pg_catalog.length(v_base)<3 then
    raise exception 'Prénoms et nom insuffisants pour générer le nom utilisateur'
      using errcode='22023';
  end if;
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
      if pg_catalog.length(v_suffix)>8 then exit; end if;
      v_candidate := pg_catalog.substr(v_base,1,10-pg_catalog.length(v_suffix)) || v_suffix;
    end if;
    if v_candidate ~ '^[a-z]{3,10}$' and not exists (
      select 1 from public.profiles p where p.username=v_candidate
    ) then
      return v_candidate;
    end if;
  end loop;
  raise exception 'Aucun nom utilisateur disponible pour cette identité'
    using errcode='54000';
end;
$username$;
revoke all on function private.magnisa_generate_username(text,text) from public,anon,authenticated;

-- The selected handle is accepted only when it follows the new format and is
-- available. The unique index remains the final concurrency-safe guarantee.
create or replace function private.magnisa_issue_profile_id()
returns trigger language plpgsql security definer set search_path=''
as $username$
declare
  v_meta jsonb;
  v_name text;
  v_requested_username text;
  v_username text;
  v_id text;
  v_attempt integer;
begin
  select coalesce(raw_user_meta_data,'{}'::jsonb) into v_meta
    from auth.users where id=new.id;
  v_name := pg_catalog.btrim(coalesce(v_meta->>'full_name',''));
  v_requested_username := pg_catalog.lower(pg_catalog.btrim(coalesce(v_meta->>'username','')));

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
    if v_requested_username ~ '^[a-z]{3,10}$' then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('magnisa-global-username-allocation',0));
      if exists (
        select 1 from public.profiles
        where username=v_requested_username and id<>new.id
      ) then
        raise exception 'Ce nom utilisateur est déjà utilisé'
          using errcode='23505';
      end if;
      v_username := v_requested_username;
    else
      v_username := private.magnisa_generate_username(
        coalesce(v_meta->>'given_names',v_name), v_meta->>'family_name');
    end if;

    update public.profiles
      set full_name=v_name, username=v_username, username_changed_at=now()
      where id=new.id;
  end if;
  return new;
end;
$username$;

-- Existing usernames remain valid when unchanged. Any newly selected alias,
-- including a first claim, must now satisfy the 3-10 lowercase-letter rule.
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

  v_username := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username,'')));
  if v_existing is null then
    if v_username !~ '^[a-z]{3,10}$' then
      v_username := private.magnisa_generate_username(v_name);
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('magnisa-global-username-allocation',0));
      if exists (select 1 from public.profiles where username=v_username and id<>v_user) then
        raise exception 'Ce nom utilisateur est déjà utilisé' using errcode='23505';
      end if;
    end if;
  else
    if v_username='' then v_username:=v_existing; end if;
    if v_username is distinct from v_existing then
      if v_username !~ '^[a-z]{3,10}$' then
        raise exception 'Le nouveau nom utilisateur doit contenir de 3 à 10 lettres minuscules'
          using errcode='22023';
      end if;
      if v_changed>now()-interval '30 days' then
        raise exception 'Modification du nom utilisateur limitée à une fois tous les 30 jours'
          using errcode='22023';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('magnisa-global-username-allocation',0));
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
