ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS magnisa_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_org_magnisa_reference_uq ON public.journal_entries(organization_id,magnisa_reference) WHERE magnisa_reference IS NOT NULL;
