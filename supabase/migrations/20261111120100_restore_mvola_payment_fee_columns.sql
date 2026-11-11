-- Restore the MVola-specific fee fields referenced by the payment RPCs.
-- These columns existed in the deployed schema but were missing from the clean migration chain.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS mvola_withdrawal_fee_option text,
  ADD COLUMN IF NOT EXISTS mvola_fee_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS mvola_fee_reimbursement numeric(18,2),
  ADD COLUMN IF NOT EXISTS mvola_fee_bearer text;

UPDATE public.payments
SET mvola_fee_amount=COALESCE(mvola_fee_amount,
      GREATEST(COALESCE(mobile_money_fee_amount,0),COALESCE(mvola_fee_reimbursement,0)),0),
    mvola_fee_reimbursement=COALESCE(mvola_fee_reimbursement,
      CASE WHEN mobile_operator='mvola' THEN COALESCE(mobile_money_fee_reimbursement,0) ELSE 0 END,0),
    mvola_fee_bearer=COALESCE(mvola_fee_bearer,
      CASE WHEN mobile_operator='mvola'
        THEN COALESCE(mobile_money_fee_bearer,CASE WHEN COALESCE(mvola_fee_reimbursement,0)>0 THEN 'client_reimbursed' ELSE 'none' END)
        ELSE 'none' END,'none')
WHERE mvola_fee_amount IS NULL OR mvola_fee_reimbursement IS NULL OR mvola_fee_bearer IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN mvola_fee_amount SET DEFAULT 0,
  ALTER COLUMN mvola_fee_amount SET NOT NULL,
  ALTER COLUMN mvola_fee_reimbursement SET DEFAULT 0,
  ALTER COLUMN mvola_fee_reimbursement SET NOT NULL,
  ALTER COLUMN mvola_fee_bearer SET DEFAULT 'none',
  ALTER COLUMN mvola_fee_bearer SET NOT NULL;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_mvola_withdrawal_fee_option_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_values_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_bearer_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_mvola_withdrawal_fee_option_check
    CHECK (mvola_withdrawal_fee_option IS NULL OR mvola_withdrawal_fee_option IN ('with_fees','without_fees')),
  ADD CONSTRAINT payments_mvola_fee_values_check
    CHECK (mvola_fee_amount>=0 AND mvola_fee_reimbursement>=0),
  ADD CONSTRAINT payments_mvola_fee_bearer_check
    CHECK (mvola_fee_bearer IN ('company','client_direct','client_reimbursed','none'));

COMMENT ON COLUMN public.payments.mvola_fee_reimbursement IS
  'Client-reimbursed share of the MVola withdrawal fee; retained separately from the generic multi-operator fee fields.';
