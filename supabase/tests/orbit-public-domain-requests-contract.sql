-- Read-only production and CI contract: requests are not live Internet mailboxes.
DO $orbit_domains$
DECLARE missing text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20261114120000') THEN
    RAISE EXCEPTION 'Orbit domain-requests migration absent';
  END IF;
  SELECT string_agg(e.name,', ')
  INTO missing FROM (
    VALUES ('mgmail_domain_requests'),('mgmail_public_address_requests')
  ) e(name)
  JOIN pg_class c ON c.oid=to_regclass('public.'||e.name)
  WHERE NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'RLS disabled: %',missing; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.oid IN (
    to_regclass('public.mgmail_domain_requests'),
    to_regclass('public.mgmail_public_address_requests')) AND c.relrowsecurity)<>2 THEN
    RAISE EXCEPTION 'Public-domain request RLS tables absent';
  END IF;
  IF has_table_privilege('anon','public.mgmail_domain_requests','SELECT')
   OR has_table_privilege('anon','public.mgmail_public_address_requests','SELECT')
   OR has_table_privilege('anon','public.mgmail_domain_requests','INSERT')
   OR has_table_privilege('anon','public.mgmail_public_address_requests','INSERT') THEN
    RAISE EXCEPTION 'Anonymous privilege escalation in domain requests';
  END IF;
  IF has_table_privilege('authenticated','public.mgmail_domain_requests','UPDATE')
   OR has_table_privilege('authenticated','public.mgmail_public_address_requests','UPDATE')
   OR has_table_privilege('authenticated','public.mgmail_domain_requests','DELETE')
   OR has_table_privilege('authenticated','public.mgmail_public_address_requests','DELETE') THEN
    RAISE EXCEPTION 'Browser clients must not approve domain or address requests';
  END IF;
  IF NOT has_column_privilege('authenticated','public.mgmail_domain_requests','domain_name','INSERT')
   OR NOT has_column_privilege('authenticated','public.mgmail_public_address_requests','local_part','INSERT') THEN
    RAISE EXCEPTION 'Authorized admins cannot submit requests';
  END IF;
  SELECT string_agg(p.name,', ')
    INTO missing FROM (
      VALUES ('mgmail_domain_requests','mgmail_domain_requests_read'),
             ('mgmail_domain_requests','mgmail_domain_requests_create'),
             ('mgmail_public_address_requests','mgmail_public_address_requests_read'),
             ('mgmail_public_address_requests','mgmail_public_address_requests_create')
    ) p(tab, name)
    LEFT JOIN pg_policies policy ON policy.schemaname='public'
      AND policy.tablename=p.tab AND policy.policyname=p.name
    WHERE policy.policyname IS NULL;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing policies: %',missing; END IF;
  RAISE NOTICE 'PASS Orbit domains: pending requests only, per-org RLS, no client activation';
END
$orbit_domains$;
