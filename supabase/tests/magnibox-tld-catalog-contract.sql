-- Read-only contract: privileged writes, suffix types and classification.
do $$
begin
 if to_regclass('public.magnibox_tld_catalog') is null
  then raise exception 'Magnibox catalogue missing'; end if;
 if not (select relrowsecurity from pg_class where oid='public.magnibox_tld_catalog'::regclass)
  then raise exception 'Magnibox catalogue RLS disabled'; end if;
 if has_table_privilege('anon','public.magnibox_tld_catalog','SELECT')
   or has_table_privilege('anon','public.magnibox_tld_catalog','INSERT')
   or has_table_privilege('authenticated','public.magnibox_tld_catalog','INSERT')
   or has_table_privilege('authenticated','public.magnibox_tld_catalog','UPDATE')
   or has_table_privilege('authenticated','public.magnibox_tld_catalog','DELETE')
  then raise exception 'Magnibox TLD catalogue is browser-writable or public'; end if;
 if not has_table_privilege('authenticated','public.magnibox_tld_catalog','SELECT')
  then raise exception 'Magnibox TLD authenticated read access missing'; end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='magnibox_tld_catalog'
   and policyname='magnibox_tld_catalog_authenticated_read')
  then raise exception 'Magnibox TLD read policy missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.magnibox_tld_catalog'::regclass
  and conname='magnibox_tld_suffix_kind')
  then raise exception 'Suffix type/root distinction missing'; end if;
end $$;
