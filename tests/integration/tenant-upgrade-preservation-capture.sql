-- Capture stable tenant-scoped row identities from the restored production snapshot.
-- This schema exists only in the disposable restore database, never in production.
CREATE SCHEMA magnisa_upgrade_verification;

CREATE TABLE magnisa_upgrade_verification.baseline (
  table_name text NOT NULL,
  tenant_key text NOT NULL,
  row_count bigint NOT NULL,
  identity_digest text NOT NULL,
  PRIMARY KEY (table_name, tenant_key)
);

DO $$
DECLARE
  rec record;
  pk_columns text;
  identity_expression text;
  organization_count bigint;
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL THEN
    RAISE EXCEPTION 'Tenant upgrade baseline requires organizations and organization_members';
  END IF;

  SELECT count(*) INTO organization_count FROM public.organizations;
  IF organization_count < 1 THEN
    RAISE EXCEPTION 'Tenant upgrade baseline found no existing organizations in the restored snapshot';
  END IF;

  INSERT INTO magnisa_upgrade_verification.baseline
    (table_name, tenant_key, row_count, identity_digest)
  SELECT 'organizations', id::text, 1, md5(id::text)
  FROM public.organizations;

  FOR rec IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE i.indisprimary
          AND n.nspname = 'public'
          AND t.relname = c.table_name
      )
    ORDER BY c.table_name
  LOOP
    SELECT string_agg(format('t.%I', a.attname), ', ' ORDER BY k.ordinality)
      INTO pk_columns
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE i.indisprimary
      AND n.nspname = 'public'
      AND t.relname = rec.table_name
      AND k.ordinality <= i.indnkeyatts;

    IF pk_columns IS NULL OR pk_columns = '' THEN
      RAISE EXCEPTION 'Could not identify primary key for tenant table public.%', rec.table_name;
    END IF;

    IF rec.table_name = 'organization_members' THEN
      identity_expression := format(
        'jsonb_build_array(%s, to_jsonb(t)->>''role'', to_jsonb(t)->>''status'')::text',
        pk_columns
      );
    ELSE
      identity_expression := format('jsonb_build_array(%s)::text', pk_columns);
    END IF;

    EXECUTE format(
      'INSERT INTO magnisa_upgrade_verification.baseline (table_name, tenant_key, row_count, identity_digest)
       SELECT %L, COALESCE(t.organization_id::text, ''<NULL>''), count(*),
              md5(COALESCE(string_agg(%s, E''\n'' ORDER BY %s), ''''))
       FROM public.%I t
       GROUP BY COALESCE(t.organization_id::text, ''<NULL>'')',
      rec.table_name, identity_expression, identity_expression, rec.table_name
    );
  END LOOP;

  -- Preserve an explicit empty-table fingerprint too, so the CI smoke test
  -- can validate the assertion even when its disposable fixtures have no
  -- remaining Auth memberships after their temporary users are cleaned up.
  INSERT INTO magnisa_upgrade_verification.baseline
    (table_name, tenant_key, row_count, identity_digest)
  SELECT 'organization_members', '__EMPTY__', 0, md5('')
  WHERE NOT EXISTS (
    SELECT 1 FROM magnisa_upgrade_verification.baseline
    WHERE table_name = 'organization_members'
  );

  IF NOT EXISTS (
    SELECT 1 FROM magnisa_upgrade_verification.baseline
    WHERE table_name = 'organization_members'
  ) THEN
    RAISE EXCEPTION 'Tenant upgrade baseline could not fingerprint organization_members';
  END IF;

  RAISE NOTICE 'Captured % existing organizations and % tenant-scoped table/tenant groups',
    organization_count,
    (SELECT count(*) FROM magnisa_upgrade_verification.baseline WHERE table_name <> 'organizations');
END $$;
