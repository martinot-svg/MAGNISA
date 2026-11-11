-- MAGNISA: automatic customer creation when a prospect is marked as won.
-- This is an additive migration: the original commission migration remains immutable.

create or replace function public.auto_convert_won_prospect()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing_customer uuid;
  v_customer uuid;
  v_email text;
  v_phone text;
begin
  if tg_op = 'UPDATE' and old.converted_customer_id is not null then
    if new.converted_customer_id is distinct from old.converted_customer_id or new.status <> 'won' then
      raise exception 'Un prospect converti doit conserver son client et son statut Gagné.';
    end if;
    return new;
  end if;

  if new.converted_customer_id is not null then
    raise exception 'Le client est créé automatiquement lors du passage au statut Gagné.';
  end if;

  if new.status <> 'won' then
    return new;
  end if;

  if auth.uid() is null or not public.has_org_permission(new.organization_id,'prospects.convert') then
    raise exception 'Tu n''as pas l''autorisation de clôturer ce prospect comme gagné.';
  end if;

  v_email := lower(trim(coalesce(new.email,'')));
  v_phone := regexp_replace(coalesce(new.phone,''),'[^0-9]','','g');

  -- Serialize conversions sharing the same contact details to avoid duplicate
  -- customers when two prospects are closed concurrently.
  if v_email <> '' then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':email:' || v_email,0));
  end if;
  if v_phone <> '' then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':phone:' || v_phone,0));
  end if;

  if v_email <> '' or v_phone <> '' then
    select id into v_existing_customer
    from public.customers
    where organization_id=new.organization_id and is_active and (
      (v_email <> '' and lower(trim(coalesce(email,'')))=v_email)
      or (v_phone <> '' and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=v_phone)
    )
    limit 1;
    if v_existing_customer is not null then
      raise exception 'Un client actif possède déjà cet e-mail ou ce numéro. Vérifie le doublon avant conversion.';
    end if;
  end if;

  insert into public.customers(organization_id,name,email,phone,notes)
  values(new.organization_id,trim(new.name),new.email,new.phone,new.notes)
  returning id into v_customer;

  new.converted_customer_id := v_customer;
  new.updated_at := now();
  perform public.audit_event(new.organization_id,'prospect.converted','prospects',new.id,
    case when tg_op = 'UPDATE'
      then jsonb_build_object('status',old.status,'converted_customer_id',old.converted_customer_id)
      else null end,
    jsonb_build_object('status','won','converted_customer_id',v_customer,'conversion_mode','automatic_on_won'));
  return new;
end;
$$;

drop trigger if exists prospect_auto_convert_won on public.prospects;
create trigger prospect_auto_convert_won
before insert or update of status, converted_customer_id on public.prospects
for each row
execute function public.auto_convert_won_prospect();

create or replace function public.convert_prospect_to_customer(
  p_org uuid,p_prospect uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prospect public.prospects%rowtype;
  v_customer uuid;
begin
  if auth.uid() is null or not public.has_org_permission(p_org,'prospects.convert') then
    raise exception 'Tu n''as pas l''autorisation de convertir ce prospect.';
  end if;
  select * into v_prospect from public.prospects
  where id=p_prospect and organization_id=p_org for update;
  if not found then raise exception 'Prospect introuvable.'; end if;
  if v_prospect.converted_customer_id is not null then
    return v_prospect.converted_customer_id;
  end if;
  if v_prospect.status='lost' then raise exception 'Un prospect perdu ne peut pas être converti.'; end if;

  update public.prospects
  set status='won',updated_at=now()
  where id=p_prospect and organization_id=p_org
  returning converted_customer_id into v_customer;

  if v_customer is null then
    raise exception 'La conversion automatique n''a pas créé le client attendu.';
  end if;
  return v_customer;
end;
$$;

revoke all on function public.auto_convert_won_prospect() from public, anon;
revoke all on function public.convert_prospect_to_customer(uuid,uuid) from public, anon;
grant execute on function public.convert_prospect_to_customer(uuid,uuid) to authenticated;
