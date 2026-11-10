-- Preserve purchase price adjustments as explicit line-level amounts.
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS discount_amount numeric(18,2) NOT NULL DEFAULT 0
    CHECK (discount_amount >= 0),
  ADD COLUMN IF NOT EXISTS additional_cost_amount numeric(18,2) NOT NULL DEFAULT 0
    CHECK (additional_cost_amount >= 0);

ALTER TABLE public.purchase_order_lines
  DROP CONSTRAINT IF EXISTS purchase_order_lines_discount_within_gross;

ALTER TABLE public.purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_discount_within_gross
  CHECK (discount_amount <= quantity_ordered * unit_price);
