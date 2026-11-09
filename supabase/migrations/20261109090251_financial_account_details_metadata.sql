-- Dashboard metadata used to scope financial accounts by currency.
-- Additive compatibility field; existing balances and transactions are untouched.
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
