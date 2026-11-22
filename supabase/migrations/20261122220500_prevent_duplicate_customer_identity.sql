-- Prevent new customer duplicates without deleting or rewriting existing production records.
-- The advisory lock serializes concurrent customer inserts within one organization.
create index if not exists customers_org_normalized_email_idx
  on public.customers (organization_id, lower(btrim(email)))
  where email is not null and btrim(email) <> '';

create index if not exists customers_org_phone_digits_idx
  on public.customers (organization_id, (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')))
  where phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') <> '';

create or replace function public.prevent_duplicate_customer_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_email text;
  normalized_phone text;
begin
  normalized_email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  normalized_phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');

  if tg_op = 'UPDATE' then
    if normalized_email is not distinct from nullif(lower(btrim(coalesce(old.email, ''))), '')
       and normalized_phone is not distinct from nullif(regexp_replace(coalesce(old.phone, ''), '[^0-9]', '', 'g'), '') then
      return new;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.organization_id::text), hashtext('customer-identity'));

  if normalized_email is not null and exists (
    select 1
    from public.customers c
    where c.organization_id = new.organization_id
      and c.id is distinct from new.id
      and lower(btrim(coalesce(c.email, ''))) = normalized_email
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'customers_org_normalized_email_unique',
      message = 'Un client de cette organisation utilise déjà cet e-mail.';
  end if;

  if normalized_phone is not null and exists (
    select 1
    from public.customers c
    where c.organization_id = new.organization_id
      and c.id is distinct from new.id
      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'customers_org_phone_digits_unique',
      message = 'Un client de cette organisation utilise déjà ce numéro de téléphone.';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_prevent_duplicate_identity on public.customers;
create trigger customers_prevent_duplicate_identity
before insert or update of email, phone on public.customers
for each row execute function public.prevent_duplicate_customer_identity();
