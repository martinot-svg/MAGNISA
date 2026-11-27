DO $contract$
DECLARE
  v_fk record;
BEGIN
  -- The three audited duplicates must be gone; migration is intentionally
  -- limited to these indexes.
  IF to_regclass('public.customers_id_organization_uidx') IS NOT NULL
     OR to_regclass('public.expenses_org_magnisa_reference_uq') IS NOT NULL
     OR to_regclass('public.journal_entries_org_magnisa_reference_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'Verified removable duplicate indexes were not removed';
  END IF;

  -- Canonical indexes and both candidate unique indexes for invoice_lines
  -- must exist, be ready/valid, and remain unique.
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('customers_id_org_unique'),
      ('expenses_magnisa_reference_unique'),
      ('invoice_lines_id_organization_uidx'),
      ('invoice_lines_id_org_uidx'),
      ('journal_entries_magnisa_reference_unique')
    ) AS expected(index_name)
    LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || expected.index_name)
    LEFT JOIN pg_index i ON i.indexrelid=c.oid
    WHERE c.oid IS NULL OR i.indexrelid IS NULL
       OR NOT i.indisunique OR NOT i.indisvalid OR NOT i.indisready
  ) THEN
    RAISE EXCEPTION 'Required canonical or FK-supporting unique indexes are missing or invalid';
  END IF;

  -- FK-to-index selection is PostgreSQL catalog behavior, not an application
  -- invariant. Validate the FK and accept any retained compatible unique index.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_index ix ON ix.indexrelid=fk.conindid
    WHERE fk.conrelid='public.resource_reservations'::regclass
      AND fk.conname='resource_reservations_customer_org_fk'
      AND fk.contype='f' AND fk.convalidated
      AND fk.conindid='public.customers_id_org_unique'::regclass
      AND ix.indisunique AND ix.indisvalid AND ix.indisready
  ) THEN
    RAISE EXCEPTION 'Customer foreign key must be validated and backed by its canonical unique index';
  END IF;

  FOR v_fk IN
    SELECT fk.conname, fk.convalidated, fk.conindid
    FROM pg_constraint fk
    WHERE (fk.conrelid='public.credit_note_lines'::regclass
           AND fk.conname='credit_note_lines_invoice_line_org_fkey')
       OR (fk.conrelid='public.stock_return_lines'::regclass
           AND fk.conname='stock_return_lines_source_invoice_line_id_organization_id_fkey')
  LOOP
    IF NOT v_fk.convalidated OR v_fk.conindid NOT IN (
      'public.invoice_lines_id_organization_uidx'::regclass,
      'public.invoice_lines_id_org_uidx'::regclass
    ) THEN
      RAISE EXCEPTION 'FK % is not validated or is not backed by a retained compatible invoice-line index', v_fk.conname;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_constraint
      WHERE contype='f'
        AND ((conrelid='public.credit_note_lines'::regclass
              AND conname='credit_note_lines_invoice_line_org_fkey')
          OR (conrelid='public.stock_return_lines'::regclass
              AND conname='stock_return_lines_source_invoice_line_id_organization_id_fkey'))) <> 2 THEN
    RAISE EXCEPTION 'Both invoice-line foreign keys must exist';
  END IF;

  -- No identical valid indexes should remain on the audited relations.
  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public'
      AND t.relname IN ('customers','expenses','journal_entries')
      AND i.indisvalid
    GROUP BY t.relname,i.indkey::text,i.indclass::text,
             i.indcollation::text,i.indoption::text,
             coalesce(pg_get_expr(i.indexprs,i.indrelid), ''),
             coalesce(pg_get_expr(i.indpred,i.indrelid), ''),
             i.indisunique,i.indisprimary
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Removable identical indexes remain on audited tables';
  END IF;
END;
$contract$;
