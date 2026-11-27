-- Store signup phone contacts privately without changing Supabase email OTP flow.
create table if not exists private.magnisa_user_contact (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  country_iso2 text not null check (country_iso2 ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.magnisa_user_contact enable row level security;
revoke all on private.magnisa_user_contact from public, anon, authenticated;

create or replace function public.register_magnisa_signup_phone(
  p_user uuid, p_phone_e164 text, p_country_iso2 text
) returns void
language plpgsql security definer set search_path=''
as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  if p_user is null or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_country_iso2 !~ '^[A-Z]{2}$' then
    raise exception 'Numéro de téléphone invalide' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users where id=p_user) then
    raise exception 'Utilisateur inexistant' using errcode='P0002';
  end if;
  insert into private.magnisa_user_contact(user_id,phone_e164,country_iso2)
  values(p_user,p_phone_e164,p_country_iso2)
  on conflict(user_id) do update set
    phone_e164=excluded.phone_e164,country_iso2=excluded.country_iso2,updated_at=now();
end;
$magnisa$;
revoke all on function public.register_magnisa_signup_phone(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_magnisa_signup_phone(uuid,text,text) to service_role;

create or replace function public.get_magnisa_signup_phone(p_user uuid)
returns table(phone_e164 text,country_iso2 text)
language plpgsql security definer set search_path=''
as $magnisa$
begin
  if coalesce((select auth.jwt())->>'role','') <> 'service_role' then
    raise exception 'Service interne uniquement' using errcode='42501';
  end if;
  return query select c.phone_e164,c.country_iso2
    from private.magnisa_user_contact c where c.user_id=p_user;
end;
$magnisa$;
revoke all on function public.get_magnisa_signup_phone(uuid) from public,anon,authenticated;
grant execute on function public.get_magnisa_signup_phone(uuid) to service_role;
