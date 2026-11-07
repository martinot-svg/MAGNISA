do $$
begin
  if has_function_privilege('authenticated', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.auto_convert_won_prospect()', 'EXECUTE') then
    raise exception 'Trigger-only auto_convert_won_prospect must not be executable by anon';
  end if;

  if exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole
      and n.nspname='public'
      and d.defaclobjtype='f'
      and a.privilege_type='EXECUTE'
      and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'New public functions must not grant EXECUTE to authenticated, anon or PUBLIC by default';
  end if;
end;
$$;


-- SECURITY DEFINER routines must pin trusted system and application schemas.
DO $search_path$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='create_recurring_service_contract'
      AND p.prosecdef
      AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: create_recurring_service_contract search_path is not pinned';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private'
      AND p.proname='process_due_recurring_invoice_drafts'
      AND p.prosecdef
      AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, private']
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: process_due_recurring_invoice_drafts search_path is not pinned';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='set_recurring_service_status'
      AND p.prosecdef
      AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: set_recurring_service_status search_path is not pinned';
  END IF;
END
$search_path$;
