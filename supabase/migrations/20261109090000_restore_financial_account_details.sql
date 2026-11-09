-- Restore the documented financial account metadata contract on clean installs.
-- Production already has this JSONB field populated; the recovered core baseline
-- omitted it, which made fresh migration replays diverge from the live schema.
-- IF NOT EXISTS preserves all existing account metadata and is safe on production.
alter table public.financial_accounts
  add column if not exists details jsonb not null default '{}'::jsonb;
