DO $contract$
BEGIN
  IF to_regclass('public.customers_id_organization_uidx') IS NOT NULL
     OR to_regclass('public.expenses_org_magnisa_reference_uq') IS NOT NULL
     OR to_regclass('public.journal_entries_org_magnisa_reference_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'Verified removable duplicate indexes were not removed';
  END IF;

  IF to_regclass('public.customers_id_org_unique') IS NULL
     OR to_regclass('public.expenses_magnisa_reference_unique') IS NULL
     OR to_regclass('public.invoice_lines_id_organization_uidx') IS NULL
     OR to_regclass('public.invoice_lines_id_org_uidx') IS NULL
     OR to_regclass('public.journal_entries_magnisa_reference_unique') IS NULL THEN
    RAISE EXCEPTION 'Canonical indexes and FK-supporting invoice-line index must remain';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.resource_reservations'::regclass
      AND conname='resource_reservations_customer_org_fk'
      AND conindid='public.customers_id_org_unique'::regclass
  ) THEN
    RAISE EXCEPTION 'Customer foreign key must retain its canonical unique index';
  END IF;

  -- PostgreSQL may bind each composite FK to either equivalent unique index,
  -- depending on which matching index existed when the constraint was created.
  -- Both indexes are intentionally retained: dropping the duplicate can fail
  -- on clean replay when a constraint is attached to it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.credit_note_lines'::regclass
      AND conname='credit_note_lines_invoice_line_org_fkey'
      AND conindid IN (
        'public.invoice_lines_id_organization_uidx'::regclass,
        'public.invoice_lines_id_org_uidx'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'Credit-note invoice-line foreign key must reference a retained unique index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.stock_return_lines'::regclass
      AND conname='stock_return_lines_source_invoice_line_id_organization_id_fkey'
      AND conindid IN (
        'public.invoice_lines_id_organization_uidx'::regclass,
        'public.invoice_lines_id_org_uidx'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'Stock-return invoice-line foreign key must reference a retained unique index';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_class ix ON ix.oid=i.indexrelid
    WHERE n.nspname='public'
      AND t.relname IN ('customers','expenses','journal_entries')
      AND i.indisvalid
    GROUP BY t.relname,ix.relam,i.indkey::text,i.indclass::text,
             i.indcollation::text,i.indoption::text,
             coalesce(pg_get_expr(i.indexprs,i.indrelid), ''),
             coalesce(pg_get_expr(i.indpred,i.indrelid), ''),
             i.indisunique,i.indprimary
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Removable identical indexes remain on audited tables';
  END IF;
END;
$contract$;
