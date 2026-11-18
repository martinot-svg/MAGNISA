-- Read-only contract for MAGNIBOX's free platform-owned domain pool.
do $magnibox_platform_domain_contract$
begin
  if to_regclass('public.magnibox_platform_domain_catalog') is null
    or to_regclass('public.magnibox_platform_domain_allocations') is null then
    raise exception 'MAGNIBOX platform domain tables missing';
  end if;

  if (select count(*) from pg_class where oid in (
    'public.magnibox_platform_domain_catalog'::regclass,
    'public.magnibox_platform_domain_allocations'::regclass
  ) and relrowsecurity)<>2 then
    raise exception 'MAGNIBOX platform domain RLS is disabled';
  end if;

  if has_table_privilege('anon','public.magnibox_platform_domain_catalog','SELECT')
    or has_table_privilege('anon','public.magnibox_platform_domain_catalog','INSERT')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_catalog','INSERT')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_catalog','UPDATE')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_catalog','DELETE')
    or has_table_privilege('anon','public.magnibox_platform_domain_allocations','SELECT')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_allocations','INSERT')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_allocations','UPDATE')
    or has_table_privilege('authenticated','public.magnibox_platform_domain_allocations','DELETE') then
    raise exception 'MAGNIBOX platform domains allow unsafe browser access';
  end if;

  if not has_table_privilege('authenticated','public.magnibox_platform_domain_catalog','SELECT')
    or not has_table_privilege('authenticated','public.magnibox_platform_domain_allocations','SELECT') then
    raise exception 'MAGNIBOX platform domain read grants missing';
  end if;

  if not has_function_privilege('authenticated',
      'public.magnibox_reserve_free_domain(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon',
      'public.magnibox_reserve_free_domain(uuid,uuid,text)','EXECUTE') then
    raise exception 'MAGNIBOX free domain reservation RPC grants are incorrect';
  end if;

  if not exists(select 1 from pg_trigger
    where tgrelid='public.magnibox_platform_domain_allocations'::regclass
      and tgname='trg_magnibox_guard_platform_domain_allocation' and not tgisinternal) then
    raise exception 'MAGNIBOX platform domain allocation guard missing';
  end if;

  if not exists(select 1 from pg_constraint
    where conrelid='public.magnibox_platform_domain_catalog'::regclass
      and conname='magnibox_platform_domain_selectable')
    or not exists(select 1 from pg_constraint
    where conrelid='public.magnibox_platform_domain_allocations'::regclass
      and conname='magnibox_platform_allocation_active_gate') then
    raise exception 'MAGNIBOX domain readiness or activation constraints missing';
  end if;

  raise notice 'PASS MAGNIBOX free platform domain catalogue: RLS, operator-only pool, tenant reservation and activation gates';
end
$magnibox_platform_domain_contract$;
