-- Stable client request identity makes the server action retry-safe even when
-- a network retry reaches the action after the first request committed.
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_org_request_key_uidx
  ON public.goods_receipts(organization_id,request_key)
  WHERE request_key IS NOT NULL;
