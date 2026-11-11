-- Keep legacy MVola fee columns required by record_customer_payment_with_fee_v3
-- alongside the generalized Mobile Money fee fields.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS mvola_withdrawal_fee_option text,
  ADD COLUMN IF NOT EXISTS mvola_fee_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mvola_fee_reimbursement numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mvola_fee_bearer text NOT NULL DEFAULT 'none';

UPDATE public.payments
SET mvola_fee_amount=CASE WHEN mobile_operator='mvola' THEN mobile_money_fee_amount ELSE 0 END,
    mvola_fee_reimbursement=CASE WHEN mobile_operator='mvola' THEN mobile_money_fee_reimbursement ELSE 0 END,
    mvola_fee_bearer=CASE WHEN mobile_operator='mvola' THEN mobile_money_fee_bearer ELSE 'none' END
WHERE mvola_fee_amount=0 AND mvola_fee_reimbursement=0 AND mvola_fee_bearer='none';

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_amount_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_reimbursement_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_fee_bearer_check,
  DROP CONSTRAINT IF EXISTS payments_mvola_withdrawal_fee_option_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_mvola_fee_amount_check CHECK (mvola_fee_amount>=0),
  ADD CONSTRAINT payments_mvola_fee_reimbursement_check CHECK (mvola_fee_reimbursement>=0 AND mvola_fee_reimbursement<=mvola_fee_amount),
  ADD CONSTRAINT payments_mvola_fee_bearer_check CHECK (mvola_fee_bearer IN ('company','client_direct','client_reimbursed','none')),
  ADD CONSTRAINT payments_mvola_withdrawal_fee_option_check
    CHECK (mvola_withdrawal_fee_option IS NULL OR mvola_withdrawal_fee_option IN ('with_fees','without_fees'));
