-- Add the MVola-specific fields used by the reimbursement RPCs and treasury UI.
-- Existing payments remain valid: no withdrawal option is inferred retroactively,
-- and the reimbursement amount starts at zero.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS mvola_withdrawal_fee_option text,
  ADD COLUMN IF NOT EXISTS mvola_fee_reimbursement numeric(18,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_mvola_withdrawal_fee_option_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_reimbursement_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_mvola_withdrawal_fee_option_check
    CHECK (mvola_withdrawal_fee_option IS NULL OR mvola_withdrawal_fee_option IN ('with_fees', 'without_fees')),
  ADD CONSTRAINT payments_mvola_fee_reimbursement_check
    CHECK (mvola_fee_reimbursement >= 0);
