-- Enforce customer availability at the database boundary.
-- Existing commercial documents remain readable and payable; only new document
-- creation or reassignment to an unavailable customer is blocked.

create or replace function public.assert_customer_available_for_new_operation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer_active boolean;
begin
  select c.is_active
    into v_customer_active
  from public.customers c
  where c.id = new.customer_id
    and c.organization_id = new.organization_id;

  if not found then
    raise exception 'Client introuvable dans cette organisation.';
  end if;

  if not v_customer_active then
    raise exception 'Ce client est archivé ou désactivé. Réactive sa fiche avant de créer une nouvelle commande ou facture.';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_require_active_customer on public.orders;
create trigger orders_require_active_customer
before insert or update of customer_id on public.orders
for each row
execute function public.assert_customer_available_for_new_operation();

drop trigger if exists invoices_require_active_customer on public.invoices;
create trigger invoices_require_active_customer
before insert or update of customer_id on public.invoices
for each row
execute function public.assert_customer_available_for_new_operation();

revoke all on function public.assert_customer_available_for_new_operation() from public, anon, authenticated;
