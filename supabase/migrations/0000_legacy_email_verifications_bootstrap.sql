-- Production had this legacy table before the timestamped migration ledger began.
-- The historical 0008 migration hardens it and the later 0015 migration removes it.
-- Recreate only this pre-ledger object for a clean local replay; do not recreate core schema.
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text,
  created_at timestamptz NOT NULL DEFAULT now()
);
