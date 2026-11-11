ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS magnisa_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_org_magnisa_reference_uq ON public.expenses(organization_id,magnisa_reference) WHERE magnisa_reference IS NOT NULL;
