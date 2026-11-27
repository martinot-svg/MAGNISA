-- D-01: private date of birth and explicit majority declaration for new accounts.
-- Forward-only; does not alter existing profiles or account IDs.
create table if not exists private.magnisa_signup_age_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date not null,
  majority_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint magnisa_signup_birth_date_not_future check (birth_date <= current_date)
);
alter table private.magnisa_signup_age_checks enable row level security;
revoke all on private.magnisa_signup_age_checks from public, anon, authenticated;

create or replace function public.register_magnisa_signup_age(
  p_user uuid, p_birth_date date, p_majority_confirmed boolean
) returns void
language plpgsql security definer set search_path=''
as $magnisa$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_anniversary date;
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if p_user is null or p_birth_date is null or p_birth_date > v_today
     or p_majority_confirmed is distinct from true then
    raise exception 'Données de majorité invalides' using errcode='22023';
  end if;
  -- Explicitly clamp Feb 29 to Feb 28 in non-leap anniversary years.
  v_anniversary := make_date(
    extract(year from p_birth_date)::integer + 18,
    extract(month from p_birth_date)::integer,
    least(extract(day from p_birth_date)::integer,
      extract(day from (date_trunc('month', make_date(
        extract(year from p_birth_date)::integer + 18,
        extract(month from p_birth_date)::integer, 1
      )) + interval '1 month - 1 day'))::integer)
  );
  if v_today < v_anniversary then
    raise exception 'Âge minimum de 18 ans non atteint' using errcode='22023';
  end if;
  insert into private.magnisa_signup_age_checks(user_id,birth_date,majority_confirmed_at)
  values(p_user,p_birth_date,now())
  on conflict(user_id) do nothing;
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_age(uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.register_magnisa_signup_age(uuid,date,boolean) to service_role;
