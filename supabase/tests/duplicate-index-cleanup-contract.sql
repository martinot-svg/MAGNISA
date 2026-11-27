DO $contract$
BEGIN
  IF to_regclass('public.customers_id_organization_uidx') IS NOT NULL
     OR to_regclass('public.expenses_org_magnisa_reference_uq') IS NOT NULL
     OR to_regclass('public.invoice_lines_id_org_uidx') IS NOT NULL
     OR to_regclass('public.journal_entries_org_magnisa_reference_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'Verified duplicate indexes were not removed';
  END IF;

  IF to_regclass('public.customers_id_org_unique') IS NULL
     OR to_regclass('public.expenses_magnisa_reference_unique') IS NULL
     OR to_regclass('public.invoice_lines_id_organization_uidx') IS NULL
     OR to_regclass('public.journal_entries_magnisa_reference_unique') IS NULL THEN
    RAISE EXCEPTION 'Canonical unique indexes must remain';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='resource_reservations_customer_org_fk'
      AND conindid='public.customers_id_org_unique'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='credit_note_lines_invoice_line_org_fkey'
      AND conindid='public.invoice_lines_id_organization_uidx'::regclass
  ) THEN
    RAISE EXCEPTION 'Constraint-backed unique indexes must be preserved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public'
      AND t.relname IN ('customers','expenses','invoice_lines','journal_entries')
      AND i.indisvalid
    GROUP BY t.relname,pg_get_indexdef(i.indexrelid)
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'Identical indexes remain on audited tables';
  END IF;
END;
$contract$;
