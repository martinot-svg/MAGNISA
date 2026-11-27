-- D-01: private birthdate staging and age record for new signups.
-- DOB is not written to auth user_metadata. Staging is service-role-only and
-- consumed transactionally by an auth.users trigger; expired staging is purged
-- whenever a new registration is staged.
create table if not exists private.magnisa_signup_age_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date not null,
  majority_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint magnisa_signup_birth_date_not_future check (birth_date <= current_date)
);
alter table private.magnisa_signup_age_checks enable row level security;
revoke all on private.magnisa_signup_age_checks from public, anon, authenticated;

create table if not exists private.magnisa_signup_age_pending (
  email text primary key,
  birth_date date not null,
  majority_confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint magnisa_signup_age_pending_email_lower check (email = lower(btrim(email)))
);
alter table private.magnisa_signup_age_pending enable row level security;
revoke all on private.magnisa_signup_age_pending from public, anon, authenticated;

create or replace function private.magnisa_is_adult(p_birth_date date, p_today date)
returns boolean language plpgsql immutable security definer set search_path=''
as $magnisa$
declare
  v_year integer;
  v_month integer;
  v_day integer;
  v_last_day integer;
  v_anniversary date;
begin
  if p_birth_date is null or p_today is null or p_birth_date > p_today then return false; end if;
  v_year := extract(year from p_birth_date)::integer + 18;
  v_month := extract(month from p_birth_date)::integer;
  v_day := extract(day from p_birth_date)::integer;
  v_last_day := extract(day from (make_date(v_year,v_month,1) + interval '1 month - 1 day'))::integer;
  v_anniversary := make_date(v_year,v_month,least(v_day,v_last_day));
  return p_today >= v_anniversary;
end;
$magnisa$;
revoke all on function private.magnisa_is_adult(date,date) from public,anon,authenticated;

create or replace function public.stage_magnisa_signup_age(
  p_email text, p_birth_date date, p_majority_confirmed boolean
) returns void language plpgsql security definer set search_path=''
as $magnisa$
declare
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_today date := (now() at time zone 'UTC')::date;
  v_updated integer;
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_majority_confirmed is distinct from true
     or not private.magnisa_is_adult(p_birth_date,v_today) then
    raise exception 'Données de majorité invalides' using errcode='22023';
  end if;
  delete from private.magnisa_signup_age_pending where expires_at <= now();
  insert into private.magnisa_signup_age_pending(email,birth_date,majority_confirmed_at,expires_at)
  values(v_email,p_birth_date,now(),now()+interval '15 minutes')
  on conflict(email) do update set birth_date=excluded.birth_date,
    majority_confirmed_at=excluded.majority_confirmed_at,
    expires_at=excluded.expires_at,created_at=now()
  where private.magnisa_signup_age_pending.expires_at <= now();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Une demande d’inscription est déjà en cours' using errcode='23505';
  end if;
end;
$magnisa$;
revoke all on function public.stage_magnisa_signup_age(text,date,boolean) from public,anon,authenticated;
grant execute on function public.stage_magnisa_signup_age(text,date,boolean) to service_role;

create or replace function public.cancel_magnisa_signup_age_pending(p_email text)
returns void language plpgsql security definer set search_path=''
as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  delete from private.magnisa_signup_age_pending where email=lower(btrim(coalesce(p_email,'')));
end;
$magnisa$;
revoke all on function public.cancel_magnisa_signup_age_pending(text) from public,anon,authenticated;
grant execute on function public.cancel_magnisa_signup_age_pending(text) to service_role;

create or replace function private.magnisa_consume_pending_signup_age()
returns trigger language plpgsql security definer set search_path=''
as $magnisa$
declare v_pending record; v_today date := (now() at time zone 'UTC')::date;
begin
  select birth_date,majority_confirmed_at into v_pending
  from private.magnisa_signup_age_pending
  where email=lower(btrim(coalesce(new.email,''))) and expires_at>now()
  for update;
  if found then
    if not private.magnisa_is_adult(v_pending.birth_date,v_today) then
      raise exception 'Âge minimum de 18 ans non atteint' using errcode='22023';
    end if;
    insert into private.magnisa_signup_age_checks(user_id,birth_date,majority_confirmed_at)
    values(new.id,v_pending.birth_date,v_pending.majority_confirmed_at);
    delete from private.magnisa_signup_age_pending
    where email=lower(btrim(coalesce(new.email,'')));
  end if;
  return new;
end;
$magnisa$;
revoke all on function private.magnisa_consume_pending_signup_age() from public,anon,authenticated;
drop trigger if exists magnisa_consume_pending_signup_age on auth.users;
create trigger magnisa_consume_pending_signup_age
after insert on auth.users
for each row execute function private.magnisa_consume_pending_signup_age();

-- Legacy invite acceptance can register DOB through the service-role RPC.
create or replace function public.register_magnisa_signup_age(
  p_user uuid, p_birth_date date, p_majority_confirmed boolean
) returns void language plpgsql security definer set search_path=''
as $magnisa$
declare v_today date := (now() at time zone 'UTC')::date;
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if p_user is null or p_majority_confirmed is distinct from true
     or not private.magnisa_is_adult(p_birth_date,v_today) then
    raise exception 'Données de majorité invalides' using errcode='22023';
  end if;
  insert into private.magnisa_signup_age_checks(user_id,birth_date,majority_confirmed_at)
  values(p_user,p_birth_date,now())
  on conflict(user_id) do nothing;
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_age(uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.register_magnisa_signup_age(uuid,date,boolean) to service_role;
