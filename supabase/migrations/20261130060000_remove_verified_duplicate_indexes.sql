BEGIN;

-- Remove verified duplicate indexes only when no foreign key depends on them.
-- invoice_lines_id_org_uidx supports two live foreign keys and must be retained.
DROP INDEX IF EXISTS public.customers_id_organization_uidx;
DROP INDEX IF EXISTS public.expenses_org_magnisa_reference_uq;
DROP INDEX IF EXISTS public.journal_entries_org_magnisa_reference_uq;

COMMIT;
