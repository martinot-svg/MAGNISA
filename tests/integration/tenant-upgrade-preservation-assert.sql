-- Verify that applying the reviewed migration set did not lose or reassign
-- any pre-existing tenant-scoped row identities in the disposable restored snapshot.
DO $$
DECLARE
  rec record;
  pk_columns text;
  identity_expression text;
  mismatch_count bigint;
BEGIN
  IF to_regclass('magnisa_upgrade_verification.baseline') IS NULL THEN
    RAISE EXCEPTION 'Tenant upgrade baseline is missing; refusing to claim preservation';
  END IF;

  CREATE TABLE magnisa_upgrade_verification.current_state (
    table_name text NOT NULL,
    tenant_key text NOT NULL,
    row_count bigint NOT NULL,
    identity_digest text NOT NULL,
    PRIMARY KEY (table_name, tenant_key)
  );

  INSERT INTO magnisa_upgrade_verification.current_state
    (table_name, tenant_key, row_count, identity_digest)
  SELECT 'organizations', id::text, 1, md5(id::text)
  FROM public.organizations;

  FOR rec IN
    SELECT DISTINCT table_name
    FROM magnisa_upgrade_verification.baseline
    WHERE table_name <> 'organizations'
    ORDER BY table_name
  LOOP
    IF to_regclass(format('public.%I', rec.table_name)) IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = rec.table_name
           AND column_name = 'organization_id'
       ) THEN
      RAISE EXCEPTION 'Pre-existing tenant table public.% was removed or lost organization_id', rec.table_name;
    END IF;

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
      RAISE EXCEPTION 'Pre-existing tenant table public.% lost its primary key', rec.table_name;
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
      'INSERT INTO magnisa_upgrade_verification.current_state (table_name, tenant_key, row_count, identity_digest)
       SELECT %L, COALESCE(t.organization_id::text, ''<NULL>''), count(*),
              md5(COALESCE(string_agg(%s, E''\n'' ORDER BY %s), ''''))
       FROM public.%I t
       GROUP BY COALESCE(t.organization_id::text, ''<NULL>'')',
      rec.table_name, identity_expression, identity_expression, rec.table_name
    );
  END LOOP;

  SELECT count(*) INTO mismatch_count
  FROM magnisa_upgrade_verification.baseline b
  FULL OUTER JOIN magnisa_upgrade_verification.current_state c
    USING (table_name, tenant_key)
  WHERE b.table_name IS NULL
     OR c.table_name IS NULL
     OR b.row_count IS DISTINCT FROM c.row_count
     OR b.identity_digest IS DISTINCT FROM c.identity_digest;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Tenant upgrade preservation failed: % pre-existing table/tenant fingerprints were added, removed, reassigned or changed',
      mismatch_count;
  END IF;

  RAISE NOTICE 'Tenant upgrade preservation passed: all % organizations and % tenant-scoped table/tenant fingerprints are unchanged',
    (SELECT count(*) FROM magnisa_upgrade_verification.baseline WHERE table_name = 'organizations'),
    (SELECT count(*) FROM magnisa_upgrade_verification.baseline WHERE table_name <> 'organizations');

  DROP SCHEMA magnisa_upgrade_verification CASCADE;
END $$;
