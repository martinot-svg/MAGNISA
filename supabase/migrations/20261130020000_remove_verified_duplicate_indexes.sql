BEGIN;

-- These four indexes were verified in production to be exact duplicates.
-- Keep the canonical index for each key and retain all constraint-backed indexes.
DROP INDEX IF EXISTS public.customers_id_organization_uidx;
DROP INDEX IF EXISTS public.expenses_org_magnisa_reference_uq;
DROP INDEX IF EXISTS public.invoice_lines_id_org_uidx;
DROP INDEX IF EXISTS public.journal_entries_org_magnisa_reference_uq;

COMMIT;
