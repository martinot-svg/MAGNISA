-- Include transaction kinds already emitted by advance and expense-reimbursement flows.
-- These are valid ledger movements and must remain covered by an explicit check.
ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_kind_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_kind_check
  CHECK (kind = ANY (ARRAY[
    'customer_payment'::text,
    'expense'::text,
    'transfer_in'::text,
    'transfer_out'::text,
    'adjustment'::text,
    'cheque_clearance'::text,
    'fee'::text,
    'customer_fee_recharge'::text,
    'advance'::text,
    'reimbursement'::text
  ]));
