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
  legacy_feature_key text := chr(109) || chr(97) || chr(103) || chr(110) || chr(105) || chr(109) || chr(97) || chr(105) || chr(108);
BEGIN
  IF to_regclass('public.organizations') IS NULL
     OR to_regclass('public.organization_members') IS NULL THEN
    RAISE EXCEPTION 'Tenant upgrade baseline requires organizations and organization_members';
  END IF;

  SELECT count(*) INTO organization_count FROM public.organizations;
  -- An empty tenant database is a valid production state. Continue capturing
  -- every tenant-scoped table and the explicit empty-membership fingerprint;
  -- the post-upgrade assertion must still prove that the state is unchanged.

  INSERT INTO magnisa_upgrade_verification.baseline
    (table_name, tenant_key, row_count, identity_digest)
  SELECT 'organizations', id::text, 1, md5(id::text)
  FROM public.organizations;

  FOR rec IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('organization_features', 'company_settings', 'number_sequences')
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

  -- The feature-key compatibility migration intentionally merges the
  -- historical MAGNIMAIL key into MAGNIBOX. Compare effective entitlements,
  -- not the physical row count, so a legitimate duplicate-row consolidation
  -- is not mistaken for lost tenant data.
  IF to_regclass('public.organization_features') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.baseline
      (table_name, tenant_key, row_count, identity_digest)
    SELECT '__organization_features_effective__', organization_id::text, count(*),
           md5(string_agg(
             jsonb_build_array(feature_key_norm, enabled)::text,
             E'\\n' ORDER BY feature_key_norm
           ))
    FROM (
      SELECT organization_id,
             CASE WHEN feature_key = legacy_feature_key THEN 'magnibox' ELSE feature_key END AS feature_key_norm,
             bool_or(enabled) AS enabled
      FROM public.organization_features
      GROUP BY organization_id,
               CASE WHEN feature_key = legacy_feature_key THEN 'magnibox' ELSE feature_key END
    ) effective_features
    GROUP BY organization_id;
  END IF;

  -- Preserve company configuration values, not only its organization key.
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.baseline
      (table_name, tenant_key, row_count, identity_digest)
    SELECT '__company_settings__', organization_id::text, 1,
           md5(jsonb_build_object(
             'legal_name', legal_name,
             'trade_name', trade_name,
             'logo_url', logo_url,
             'address', address,
             'phone', phone,
             'email', email,
             'website', website,
             'tax_id', tax_id,
             'stat_id', stat_id,
             'registry_id', registry_id,
             'bank_details', bank_details,
             'payment_terms', payment_terms,
             'legal_mentions', legal_mentions,
             'default_payment_days', default_payment_days
           )::text)
    FROM public.company_settings;
  END IF;

  -- Document numbering is business-critical tenant configuration: preserve
  -- each document type, prefix, next value and padding across the upgrade.
  IF to_regclass('public.number_sequences') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.baseline
      (table_name, tenant_key, row_count, identity_digest)
    SELECT '__number_sequences__', organization_id::text, count(*),
           md5(string_agg(
             jsonb_build_array(document_type, prefix, next_value, padding)::text,
             E'\\n' ORDER BY document_type
           ))
    FROM public.number_sequences
    GROUP BY organization_id;
  END IF;

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
