BEGIN;

-- These indexes are exact duplicates of canonical indexes, but one legacy
-- replay path attaches two composite invoice-line foreign keys to the
-- duplicate invoice_lines index. Rebind those FKs to the canonical index
-- before removing the duplicate. Never use CASCADE or drop the constraints
-- permanently.
DO $migration$
DECLARE
  v_duplicate_index oid := to_regclass('public.invoice_lines_id_org_uidx');
BEGIN
  IF v_duplicate_index IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE contype = 'f'
      AND conindid = v_duplicate_index
      AND conname NOT IN (
        'credit_note_lines_invoice_line_org_fkey',
        'stock_return_lines_source_invoice_line_id_organization_id_fkey'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected foreign key depends on invoice_lines_id_org_uidx; refusing index cleanup';
  END IF;

  IF v_duplicate_index IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_note_lines_invoice_line_org_fkey'
      AND conindid = v_duplicate_index
  ) THEN
    ALTER TABLE public.credit_note_lines
      DROP CONSTRAINT credit_note_lines_invoice_line_org_fkey;
  END IF;

  IF v_duplicate_index IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_return_lines_source_invoice_line_id_organization_id_fkey'
      AND conindid = v_duplicate_index
  ) THEN
    ALTER TABLE public.stock_return_lines
      DROP CONSTRAINT stock_return_lines_source_invoice_line_id_organization_id_fkey;
  END IF;
END
$migration$;

DROP INDEX IF EXISTS public.customers_id_organization_uidx;
DROP INDEX IF EXISTS public.expenses_org_magnisa_reference_uq;
DROP INDEX IF EXISTS public.invoice_lines_id_org_uidx;
DROP INDEX IF EXISTS public.journal_entries_org_magnisa_reference_uq;

-- On clean replay, restore any FK that was rebound above. The canonical
-- invoice_lines_id_organization_uidx remains and is now the matching index.
DO $migration$
BEGIN
  IF to_regclass('public.invoice_lines_id_organization_uidx') IS NULL THEN
    RAISE EXCEPTION 'Canonical invoice_lines unique index is missing; refusing FK restoration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_note_lines_invoice_line_org_fkey'
      AND conrelid = 'public.credit_note_lines'::regclass
  ) THEN
    ALTER TABLE public.credit_note_lines
      ADD CONSTRAINT credit_note_lines_invoice_line_org_fkey
      FOREIGN KEY (source_invoice_line_id, organization_id)
      REFERENCES public.invoice_lines(id, organization_id)
      ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.credit_note_lines
      VALIDATE CONSTRAINT credit_note_lines_invoice_line_org_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_return_lines_source_invoice_line_id_organization_id_fkey'
      AND conrelid = 'public.stock_return_lines'::regclass
  ) THEN
    ALTER TABLE public.stock_return_lines
      ADD CONSTRAINT stock_return_lines_source_invoice_line_id_organization_id_fkey
      FOREIGN KEY (source_invoice_line_id, organization_id)
      REFERENCES public.invoice_lines(id, organization_id)
      ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.stock_return_lines
      VALIDATE CONSTRAINT stock_return_lines_source_invoice_line_id_organization_id_fkey;
  END IF;
END
$migration$;

COMMIT;
