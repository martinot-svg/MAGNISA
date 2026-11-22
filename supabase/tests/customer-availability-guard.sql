begin;

do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'orders_require_active_customer'
      and tgrelid = 'public.orders'::regclass
      and not tgisinternal
  ) then
    raise exception 'Orders must reject new operations for inactive customers';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'invoices_require_active_customer'
      and tgrelid = 'public.invoices'::regclass
      and not tgisinternal
  ) then
    raise exception 'Invoices must reject new operations for inactive customers';
  end if;

  select pg_get_functiondef(
    'public.assert_customer_available_for_new_operation()'::regprocedure
  ) into v_definition;

  if position('c.is_active' in v_definition) = 0
     or position('c.organization_id = new.organization_id' in v_definition) = 0
     or position('archivé ou désactivé' in v_definition) = 0 then
    raise exception 'Customer availability guard must enforce active status and organization isolation';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.assert_customer_available_for_new_operation()',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.assert_customer_available_for_new_operation()',
    'EXECUTE'
  ) then
    raise exception 'Trigger function must not be executable directly by client roles';
  end if;
end $$;

rollback;
