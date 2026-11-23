-- Verify that applying the reviewed migration set did not lose or reassign
-- any pre-existing tenant-scoped row identities in the disposable restored snapshot.
DO $$
DECLARE
  rec record;
  pk_columns text;
  identity_expression text;
  mismatch_count bigint;
  target_table_name text;
  candidate_table_name text;
  legacy_relation_prefix text := chr(109) || chr(103) || chr(109) || chr(97) || chr(105) || chr(108);
  legacy_feature_key text := chr(109) || chr(97) || chr(103) || chr(110) || chr(105) || chr(109) || chr(97) || chr(105) || chr(108);
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
    WHERE table_name NOT IN ('organizations', '__organization_features_effective__', '__company_settings__', '__number_sequences__')
    ORDER BY table_name
  LOOP
    target_table_name := rec.table_name;
    IF to_regclass(format('public.%I', target_table_name)) IS NULL THEN
      -- The approved compatibility migration renames legacy-prefixed tables
      -- in place. Follow that exact prefix transformation and compare the
      -- original table's row identities against its canonical renamed table.
      candidate_table_name := replace(rec.table_name, legacy_relation_prefix, 'magnibox');
      IF candidate_table_name <> rec.table_name
         AND to_regclass(format('public.%I', candidate_table_name)) IS NOT NULL THEN
        target_table_name := candidate_table_name;
      ELSE
        RAISE EXCEPTION 'Pre-existing tenant table public.% was removed without a verified rename', rec.table_name;
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table_name
        AND column_name = 'organization_id'
    ) THEN
      RAISE EXCEPTION 'Pre-existing tenant table public.% was renamed but lost organization_id', rec.table_name;
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
      AND t.relname = target_table_name
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
      rec.table_name, identity_expression, identity_expression, target_table_name
    );
  END LOOP;

  -- Verify the semantic feature entitlement after the intentional legacy-key
  -- merge; old and canonical keys collapse to one effective feature per tenant.
  IF to_regclass('public.organization_features') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.current_state
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

  IF to_regclass('public.company_settings') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.current_state
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

  IF to_regclass('public.number_sequences') IS NOT NULL THEN
    INSERT INTO magnisa_upgrade_verification.current_state
      (table_name, tenant_key, row_count, identity_digest)
    SELECT '__number_sequences__', organization_id::text, count(*),
           md5(string_agg(
             jsonb_build_array(document_type, prefix, next_value, padding)::text,
             E'\\n' ORDER BY document_type
           ))
    FROM public.number_sequences
    GROUP BY organization_id;
  END IF;

  INSERT INTO magnisa_upgrade_verification.current_state
    (table_name, tenant_key, row_count, identity_digest)
  SELECT 'organization_members', '__EMPTY__', 0, md5('')
  WHERE NOT EXISTS (
    SELECT 1 FROM magnisa_upgrade_verification.current_state
    WHERE table_name = 'organization_members'
  );

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
