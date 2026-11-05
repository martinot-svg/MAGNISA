-- The production repayment RPC records the completion timestamp on each
-- idempotency row. Keep this audit field available on existing installations.
ALTER TABLE public.lot1_financial_idempotency
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
