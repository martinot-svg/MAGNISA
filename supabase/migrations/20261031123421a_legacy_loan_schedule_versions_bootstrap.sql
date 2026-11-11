-- Local replay-only reconstruction of a pre-ledger production object.
-- The production table exists but no timestamped migration creates it; the
-- historical 20261103153930 migration expects it. The non-14-digit version
-- keeps this bootstrap out of production migration reconciliation/deployment.
CREATE TABLE IF NOT EXISTS public.loan_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_type text NOT NULL CHECK (version_type IN ('initial','amendment')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','cancelled')),
  effective_from date NOT NULL,
  effective_until date,
  amendment_reference text,
  amendment_reason text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  financial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT loan_schedule_versions_check
    CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT loan_schedule_versions_id_loan_id_organization_id_key
    UNIQUE (id,loan_id,organization_id),
  CONSTRAINT loan_schedule_versions_loan_id_version_number_key
    UNIQUE (loan_id,version_number)
);
