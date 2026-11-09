-- MAGNISA: fixed-asset register foundation (PCG 2005 + separate IFRS bridge).
-- Additive only: preserves existing fixed_assets rows and does not post accounting entries.

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS asset_code text,
  ADD COLUMN IF NOT EXISTS pcg_asset_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_accumulated_depreciation_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_depreciation_expense_account_code text,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS invoice_reference text,
  ADD COLUMN IF NOT EXISTS in_service_date date,
  ADD COLUMN IF NOT EXISTS residual_value numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS directly_attributable_cost numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS custodian text,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS disposed_at date,
  ADD COLUMN IF NOT EXISTS disposal_proceeds numeric(18,2),
  ADD COLUMN IF NOT EXISTS impairment_loss numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ifrs_classification text,
  ADD COLUMN IF NOT EXISTS ifrs_measurement_model text,
  ADD COLUMN IF NOT EXISTS ifrs_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.fixed_assets
SET in_service_date = acquisition_date
WHERE in_service_date IS NULL;

ALTER TABLE public.fixed_assets
  ALTER COLUMN in_service_date SET DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_life_positive_chk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_life_positive_chk
      CHECK (useful_life_months IS NULL OR useful_life_months > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_residual_nonnegative_chk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_residual_nonnegative_chk
      CHECK (residual_value >= 0 AND residual_value <= acquisition_cost + directly_attributable_cost);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_costs_nonnegative_chk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_costs_nonnegative_chk
      CHECK (directly_attributable_cost >= 0 AND impairment_loss >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_disposal_values_chk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_disposal_values_chk
      CHECK (disposal_proceeds IS NULL OR disposal_proceeds >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_org_asset_code_uidx
  ON public.fixed_assets (organization_id, asset_code)
  WHERE asset_code IS NOT NULL AND asset_code <> '';
CREATE INDEX IF NOT EXISTS fixed_assets_org_pcg_code_idx
  ON public.fixed_assets (organization_id, pcg_asset_account_code);
CREATE INDEX IF NOT EXISTS fixed_assets_org_status_service_date_idx
  ON public.fixed_assets (organization_id, status, in_service_date);

CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_id_org_uidx
  ON public.fixed_assets (id, organization_id);

CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  method text NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line')),
  depreciable_base numeric(18,2) NOT NULL CHECK (depreciable_base >= 0),
  opening_accumulated_depreciation numeric(18,2) NOT NULL CHECK (opening_accumulated_depreciation >= 0),
  depreciation_charge numeric(18,2) NOT NULL CHECK (depreciation_charge >= 0),
  closing_accumulated_depreciation numeric(18,2) NOT NULL CHECK (closing_accumulated_depreciation >= 0),
  closing_net_book_value numeric(18,2) NOT NULL CHECK (closing_net_book_value >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','posted','reversed')),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  calculation_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (closing_accumulated_depreciation >= opening_accumulated_depreciation),
  UNIQUE (organization_id, fixed_asset_id, period_start, period_end),
  FOREIGN KEY (fixed_asset_id, organization_id)
    REFERENCES public.fixed_assets(id, organization_id) ON DELETE RESTRICT
);

ALTER TABLE public.fixed_asset_depreciation_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixed_asset_depreciation_entries_select ON public.fixed_asset_depreciation_entries;
CREATE POLICY fixed_asset_depreciation_entries_select
  ON public.fixed_asset_depreciation_entries FOR SELECT
  USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS fixed_asset_depreciation_entries_insert ON public.fixed_asset_depreciation_entries;
CREATE POLICY fixed_asset_depreciation_entries_insert
  ON public.fixed_asset_depreciation_entries FOR INSERT
  WITH CHECK (public.has_org_permission(organization_id, 'accounting.manage'));
DROP POLICY IF EXISTS fixed_asset_depreciation_entries_update ON public.fixed_asset_depreciation_entries;
CREATE POLICY fixed_asset_depreciation_entries_update
  ON public.fixed_asset_depreciation_entries FOR UPDATE
  USING (public.has_org_permission(organization_id, 'accounting.manage'))
  WITH CHECK (public.has_org_permission(organization_id, 'accounting.manage'));

CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_entries_org_period_idx
  ON public.fixed_asset_depreciation_entries (organization_id, period_end, status);

COMMENT ON TABLE public.fixed_asset_depreciation_entries IS
  'Planning and traceability of fixed-asset depreciation. Planned rows do not create journal entries; posting requires a separately validated accounting workflow.';
COMMENT ON COLUMN public.fixed_assets.ifrs_notes IS
  'Separate IFRS bridge metadata. Must never overwrite statutory PCG 2005 carrying values.';
