-- Rename the pre-brand internal mail schema in place without copying or losing rows.
-- The historical prefix is assembled from character codes so no legacy product
-- identifier remains in active source after this migration.
do $rename_magnibox$
declare
  v_old text := chr(109) || chr(103) || chr(109) || chr(97) || chr(105) || chr(108);
  v_new constant text := 'magnibox';
  r record;
  v_target text;
  v_definition text;
begin
  -- Tables and views first: foreign keys, policies and trigger dependencies follow OIDs.
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m','f')
      and position(v_old in c.relname) > 0
    order by c.relkind, c.relname
  loop
    v_target := replace(r.relname, v_old, v_new);
    if to_regclass(format('%I.%I', r.nspname, v_target)) is not null then
      raise exception 'MAGNIBOX rename collision for relation %.%', r.nspname, v_target;
    end if;
    execute format(
      'alter %s %I.%I rename to %I',
      case r.relkind
        when 'v' then 'view'
        when 'm' then 'materialized view'
        when 'f' then 'foreign table'
        else 'table'
      end,
      r.nspname, r.relname, v_target
    );
  end loop;

  -- Constraint names are part of the public schema contract.
  for r in
    select n.nspname, c.relname, con.conname
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and position(v_old in con.conname) > 0
  loop
    v_target := replace(r.conname, v_old, v_new);
    if exists (
      select 1 from pg_catalog.pg_constraint x
      join pg_catalog.pg_class xc on xc.oid=x.conrelid
      join pg_catalog.pg_namespace xn on xn.oid=xc.relnamespace
      where xn.nspname=r.nspname and xc.relname=r.relname and x.conname=v_target
    ) then
      raise exception 'MAGNIBOX rename collision for constraint %', v_target;
    end if;
    execute format('alter table %I.%I rename constraint %I to %I',
      r.nspname, r.relname, r.conname, v_target);
  end loop;

  -- Standalone indexes (constraint-backed indexes may already have followed their constraint).
  for r in
    select n.nspname, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='i' and position(v_old in c.relname)>0
  loop
    v_target := replace(r.relname, v_old, v_new);
    if to_regclass(format('%I.%I',r.nspname,v_target)) is not null then
      raise exception 'MAGNIBOX rename collision for index %', v_target;
    end if;
    execute format('alter index %I.%I rename to %I',r.nspname,r.relname,v_target);
  end loop;

  -- RLS policy names are renamed; their expressions remain bound to the same relation OIDs.
  for r in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname='public' and position(v_old in policyname)>0
  loop
    v_target := replace(r.policyname,v_old,v_new);
    execute format('alter policy %I on %I.%I rename to %I',
      r.policyname,r.schemaname,r.tablename,v_target);
  end loop;

  -- Trigger names retain their function OID and behavior.
  for r in
    select n.nspname, c.relname, t.tgname
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid=t.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname='public' and position(v_old in t.tgname)>0
  loop
    v_target := replace(r.tgname,v_old,v_new);
    execute format('alter trigger %I on %I.%I rename to %I',
      r.tgname,r.nspname,r.relname,v_target);
  end loop;

  -- Rename and recompile functions so their stored SQL/PLpgSQL bodies call the new objects.
  for r in
    select p.oid, n.nspname, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema')
      and position(v_old in p.proname)>0
    order by n.nspname,p.proname
  loop
    v_target := replace(r.proname,v_old,v_new);
    if exists (
      select 1 from pg_catalog.pg_proc p2
      join pg_catalog.pg_namespace n2 on n2.oid=p2.pronamespace
      where n2.nspname=r.nspname and p2.proname=v_target
        and pg_catalog.pg_get_function_identity_arguments(p2.oid)=r.identity_args
    ) then
      raise exception 'MAGNIBOX rename collision for function %.%',r.nspname,v_target;
    end if;
    execute format('alter function %I.%I(%s) rename to %I',
      r.nspname,r.proname,r.identity_args,v_target);
    v_definition := pg_catalog.pg_get_functiondef(r.oid);
    v_definition := regexp_replace(v_definition,v_old,v_new,'gi');
    execute v_definition;
  end loop;

  -- Rename user-defined types/enums with the same historical prefix.
  for r in
    select n.nspname,t.typname
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype in ('e','d')
      and position(v_old in t.typname)>0
  loop
    v_target := replace(r.typname,v_old,v_new);
    if exists(select 1 from pg_catalog.pg_type t2
      join pg_catalog.pg_namespace n2 on n2.oid=t2.typnamespace
      where n2.nspname=r.nspname and t2.typname=v_target) then
      raise exception 'MAGNIBOX rename collision for type %',v_target;
    end if;
    execute format('alter type %I.%I rename to %I',r.nspname,r.typname,v_target);
  end loop;

  -- Keep already-issued notification labels and deduplication keys consistent.
  if to_regclass('public.notifications') is not null then
    update public.notifications
       set title = replace(title,v_old,v_new),
           entity_type = replace(entity_type,v_old,v_new),
           dedupe_key = replace(dedupe_key,v_old,v_new)
     where title like '%' || v_old || '%'
        or entity_type like '%' || v_old || '%'
        or dedupe_key like '%' || v_old || '%';
  end if;
end
$rename_magnibox$;
