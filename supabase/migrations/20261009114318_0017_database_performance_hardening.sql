
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists member_select on public.organization_members;
create policy member_select on public.organization_members
for select to authenticated
using (user_id = (select auth.uid()) or public.is_org_member(organization_id));

do $$
declare
  r record;
  v_cols text;
  v_name text;
begin
  for r in
    select
      c.oid as constraint_oid,
      n.nspname as schema_name,
      t.relname as table_name,
      c.conname,
      c.conkey,
      c.conrelid
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid=c.conrelid
          and i.indisvalid
          and i.indpred is null
          and (i.indkey::smallint[])[0:array_length(c.conkey,1)-1] = c.conkey
      )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by u.ord)
      into v_cols
    from unnest(r.conkey) with ordinality as u(attnum,ord)
    join pg_attribute a on a.attrelid=r.conrelid and a.attnum=u.attnum;

    v_name := left('idx_' || r.table_name || '_fk_' || r.constraint_oid::text, 63);
    execute format('create index if not exists %I on %I.%I (%s)',
                   v_name,r.schema_name,r.table_name,v_cols);
  end loop;
end
$$;
