-- Forward-only consolidation of the universal commercial and operational stock model.
-- The seven development migrations were never applied to production. Production is
-- already at 20261110100000, so this migration preserves their exact SQL ordering
-- while deploying the complete additive feature set after the live migration head.
-- Do not restore the superseded historical filenames: that would reintroduce an
-- out-of-order deployment against the production ledger.

-- BEGIN CONSOLIDATED SOURCE: 20261110092048_commercial_items_procurement_stock_ledger.sql
-- Additive commercial foundation: catalogue, procurement and append-only stock.
-- Physical receipts update quantities only. Supplier invoices and the PCG posting
-- engine remain the authority for accounting recognition.

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_id_organization_uidx
  ON public.suppliers(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_id_organization_uidx
  ON public.customers(id,organization_id);

CREATE TABLE IF NOT EXISTS public.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  description text,
  item_kind text NOT NULL DEFAULT 'merchandise'
    CHECK (item_kind IN ('merchandise','equipment','consumable','raw_material','other')),
  base_unit text NOT NULL DEFAULT 'unit',
  tracking_mode text NOT NULL DEFAULT 'quantity'
    CHECK (tracking_mode IN ('none','quantity','serial')),
  default_purchase_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (default_purchase_price >= 0),
  default_sale_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (default_sale_price >= 0),
  default_tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (default_tax_rate BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,sku),
  UNIQUE (id,organization_id)
);

CREATE TABLE IF NOT EXISTS public.stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  location_kind text NOT NULL DEFAULT 'warehouse'
    CHECK (location_kind IN ('warehouse','store','transit','virtual')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,code),
  UNIQUE (id,organization_id)
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','partially_received','received','cancelled')),
  order_date date NOT NULL DEFAULT current_date,
  expected_date date,
  currency text NOT NULL DEFAULT 'MGA' CHECK (char_length(currency)=3),
  subtotal numeric(18,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(18,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,number),
  UNIQUE (id,organization_id),
  FOREIGN KEY (supplier_id,organization_id)
    REFERENCES public.suppliers(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  description text NOT NULL,
  purchase_purpose text NOT NULL
    CHECK (purchase_purpose IN ('resale','customer_mandate','company_use','consumption')),
  beneficiary_customer_id uuid,
  mandate_confirmed boolean NOT NULL DEFAULT false,
  supplier_document_names_customer boolean NOT NULL DEFAULT false,
  company_bears_goods_risk boolean NOT NULL DEFAULT true,
  exact_cost_supported boolean NOT NULL DEFAULT false,
  mandate_supplier_document_reference text,
  quantity_ordered numeric(18,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received numeric(18,4) NOT NULL DEFAULT 0
    CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),
  unit text NOT NULL DEFAULT 'unit',
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  line_total numeric(18,2) NOT NULL CHECK (line_total >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id),
  FOREIGN KEY (purchase_order_id,organization_id)
    REFERENCES public.purchase_orders(id,organization_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id,organization_id)
    REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (beneficiary_customer_id,organization_id)
    REFERENCES public.customers(id,organization_id) ON DELETE RESTRICT,
  CHECK (
    (purchase_purpose='customer_mandate' AND beneficiary_customer_id IS NOT NULL)
    OR (purchase_purpose<>'customer_mandate' AND beneficiary_customer_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL,
  receipt_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  received_at timestamptz NOT NULL DEFAULT now(),
  supplier_delivery_reference text,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  posted_by uuid REFERENCES auth.users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,receipt_number),
  UNIQUE (id,organization_id),
  FOREIGN KEY (purchase_order_id,organization_id)
    REFERENCES public.purchase_orders(id,organization_id) ON DELETE RESTRICT,
  CHECK (status<>'posted' OR (posted_by IS NOT NULL AND posted_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  goods_receipt_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  stock_location_id uuid,
  quantity_received numeric(18,4) NOT NULL CHECK (quantity_received > 0),
  unit_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id),
  UNIQUE (goods_receipt_id,purchase_order_line_id),
  FOREIGN KEY (goods_receipt_id,organization_id)
    REFERENCES public.goods_receipts(id,organization_id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_order_line_id,organization_id)
    REFERENCES public.purchase_order_lines(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (stock_location_id,organization_id)
    REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  movement_kind text NOT NULL
    CHECK (movement_kind IN ('receipt','issue','transfer_in','transfer_out','adjustment_in','adjustment_out','customer_return','supplier_return')),
  quantity_delta numeric(18,4) NOT NULL CHECK (quantity_delta<>0),
  unit_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_cost>=0),
  currency text NOT NULL DEFAULT 'MGA' CHECK (char_length(currency)=3),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_line_id uuid,
  event_key text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,event_key),
  FOREIGN KEY (item_id,organization_id)
    REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (stock_location_id,organization_id)
    REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  CHECK (
    (movement_kind IN ('receipt','transfer_in','adjustment_in','customer_return') AND quantity_delta>0)
    OR (movement_kind IN ('issue','transfer_out','adjustment_out','supplier_return') AND quantity_delta<0)
  )
);

CREATE INDEX IF NOT EXISTS catalog_items_org_active_idx
  ON public.catalog_items(organization_id,is_active);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_date_idx
  ON public.purchase_orders(organization_id,supplier_id,order_date DESC);
CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx
  ON public.purchase_order_lines(organization_id,purchase_order_id,sort_order);
CREATE INDEX IF NOT EXISTS goods_receipts_order_idx
  ON public.goods_receipts(organization_id,purchase_order_id,received_at DESC);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_receipt_idx
  ON public.goods_receipt_lines(organization_id,goods_receipt_id);
CREATE INDEX IF NOT EXISTS stock_movements_item_location_date_idx
  ON public.stock_movements(organization_id,item_id,stock_location_id,effective_at);

DO $commercial_rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalog_items','stock_locations','purchase_orders','purchase_order_lines',
    'goods_receipts','goods_receipt_lines','stock_movements'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_org_member_all',t);
    IF t='stock_movements' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(organization_id))',t||'_org_member_select',t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id))',t||'_org_member_all',t);
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END
$commercial_rls$;

CREATE OR REPLACE FUNCTION public.prevent_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are immutable; post a compensating movement instead.';
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_stock_movement_mutation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS stock_movements_immutable ON public.stock_movements;
CREATE TRIGGER stock_movements_immutable
  BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_movement_mutation();

CREATE OR REPLACE VIEW public.stock_on_hand
WITH (security_invoker=true)
AS
SELECT organization_id,item_id,stock_location_id,
       SUM(quantity_delta)::numeric(18,4) AS quantity_on_hand
FROM public.stock_movements
GROUP BY organization_id,item_id,stock_location_id;
REVOKE ALL ON public.stock_on_hand FROM PUBLIC,anon;
GRANT SELECT ON public.stock_on_hand TO authenticated,service_role;

-- Draft commercial documents may be edited; submitted orders and posted receipts
-- are frozen. The quantity_received field is changed only by the posting RPC.
CREATE OR REPLACE FUNCTION public.guard_purchase_order_line_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  IF TG_OP='INSERT' THEN
    SELECT status INTO v_status FROM public.purchase_orders
    WHERE id=NEW.purchase_order_id AND organization_id=NEW.organization_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Purchase order lines can only be added to a draft order.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    SELECT status INTO v_status FROM public.purchase_orders
    WHERE id=OLD.purchase_order_id AND organization_id=OLD.organization_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Submitted purchase order lines are immutable.';
    END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO v_status FROM public.purchase_orders
    WHERE id=OLD.purchase_order_id AND organization_id=OLD.organization_id;
    IF v_status IS DISTINCT FROM 'draft'
       AND (to_jsonb(NEW)-'quantity_received') IS DISTINCT FROM (to_jsonb(OLD)-'quantity_received') THEN
      RAISE EXCEPTION 'Submitted purchase order lines are immutable.';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_purchase_order_line_draft() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS purchase_order_lines_draft_only ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_line_draft();

CREATE OR REPLACE FUNCTION public.guard_purchase_order_received_quantity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
  IF NEW.quantity_received IS DISTINCT FROM OLD.quantity_received
     AND current_setting('magnisa.posting_goods_receipt',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Received quantities can only be changed by posting a goods receipt.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_purchase_order_received_quantity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS purchase_order_lines_received_quantity_guard ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_received_quantity_guard
  BEFORE UPDATE OF quantity_received ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_received_quantity();

CREATE OR REPLACE FUNCTION public.guard_purchase_order_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Only draft purchase orders can be deleted.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='draft' THEN
    IF NEW.status NOT IN ('draft','submitted','cancelled') THEN
      RAISE EXCEPTION 'A draft purchase order can only be submitted or cancelled.';
    END IF;
    IF NEW.status='submitted' AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_lines
      WHERE purchase_order_id=NEW.id AND organization_id=NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'A purchase order must contain at least one line before submission.';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('magnisa.posting_goods_receipt',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Submitted purchase orders can only be changed by controlled workflow.';
  END IF;
  IF NEW.status NOT IN ('partially_received','received')
     OR (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at') THEN
    RAISE EXCEPTION 'Receipt posting may only update the purchase order receipt status.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_purchase_order_header() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS purchase_orders_submitted_immutable ON public.purchase_orders;
CREATE TRIGGER purchase_orders_submitted_immutable
  BEFORE UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_order_header();

CREATE OR REPLACE FUNCTION public.guard_goods_receipt_line_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  IF TG_OP='INSERT' THEN
    SELECT status INTO v_status FROM public.goods_receipts
    WHERE id=NEW.goods_receipt_id AND organization_id=NEW.organization_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Goods receipt lines can only be added to a draft receipt.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    SELECT status INTO v_status FROM public.goods_receipts
    WHERE id=OLD.goods_receipt_id AND organization_id=OLD.organization_id;
    IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Posted goods receipt lines are immutable.'; END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO v_status FROM public.goods_receipts
    WHERE id=OLD.goods_receipt_id AND organization_id=OLD.organization_id;
    IF v_status IS DISTINCT FROM 'draft' OR NEW.goods_receipt_id<>OLD.goods_receipt_id THEN
      RAISE EXCEPTION 'Posted goods receipt lines are immutable.';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_goods_receipt_line_draft() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS goods_receipt_lines_draft_only ON public.goods_receipt_lines;
CREATE TRIGGER goods_receipt_lines_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_goods_receipt_line_draft();

CREATE OR REPLACE FUNCTION public.guard_goods_receipt_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status='posted' THEN RAISE EXCEPTION 'Posted goods receipts are immutable.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='posted' THEN RAISE EXCEPTION 'Posted goods receipts are immutable.'; END IF;
  IF NEW.status NOT IN ('draft','posted') THEN
    RAISE EXCEPTION 'A draft goods receipt can only remain draft or be posted.';
  END IF;
  IF NEW.status='posted' AND current_setting('magnisa.posting_goods_receipt',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Goods receipts can only be posted through post_goods_receipt.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_goods_receipt_header() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS goods_receipts_posted_immutable ON public.goods_receipts;
CREATE TRIGGER goods_receipts_posted_immutable
  BEFORE UPDATE OR DELETE ON public.goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_goods_receipt_header();

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.post_goods_receipt(p_receipt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE
  v_receipt public.goods_receipts%ROWTYPE;
  v_order public.purchase_orders%ROWTYPE;
  v_line record;
  v_tracking_mode text;
  v_all_received boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

  SELECT * INTO v_receipt FROM public.goods_receipts
  WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_org_member(v_receipt.organization_id) THEN
    RAISE EXCEPTION 'Goods receipt not found or access denied.';
  END IF;
  IF v_receipt.status='posted' THEN RETURN; END IF;
  IF v_receipt.status<>'draft' THEN RAISE EXCEPTION 'Only a draft goods receipt can be posted.'; END IF;

  SELECT * INTO v_order FROM public.purchase_orders
  WHERE id=v_receipt.purchase_order_id AND organization_id=v_receipt.organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('submitted','partially_received') THEN
    RAISE EXCEPTION 'The purchase order must be submitted before receipt.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.goods_receipt_lines
    WHERE goods_receipt_id=v_receipt.id AND organization_id=v_receipt.organization_id
  ) THEN RAISE EXCEPTION 'A goods receipt must contain at least one line.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.goods_receipt_lines grl
    LEFT JOIN public.purchase_order_lines pol
      ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
    WHERE grl.goods_receipt_id=v_receipt.id AND grl.organization_id=v_receipt.organization_id
      AND (pol.id IS NULL OR pol.purchase_order_id<>v_receipt.purchase_order_id)
  ) THEN RAISE EXCEPTION 'Every goods receipt line must belong to the receipt purchase order.'; END IF;

  PERFORM set_config('magnisa.posting_goods_receipt','on',true);

  FOR v_line IN
    SELECT grl.*,pol.item_id,pol.purchase_purpose,pol.quantity_ordered,
      pol.quantity_received AS previously_received,pol.mandate_confirmed,
      pol.supplier_document_names_customer,pol.company_bears_goods_risk,
      pol.exact_cost_supported,pol.mandate_supplier_document_reference
    FROM public.goods_receipt_lines grl
    JOIN public.purchase_order_lines pol
      ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
    WHERE grl.goods_receipt_id=v_receipt.id AND grl.organization_id=v_receipt.organization_id
    FOR UPDATE OF pol
  LOOP
    IF v_line.purchase_purpose='customer_mandate' AND NOT (
      v_line.mandate_confirmed AND v_line.supplier_document_names_customer
      AND NOT v_line.company_bears_goods_risk AND v_line.exact_cost_supported
      AND NULLIF(trim(v_line.mandate_supplier_document_reference),'') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Customer mandate requires a confirmed mandate, supplier document in customer name, no company goods risk and exact-cost evidence.';
    END IF;

    IF v_line.previously_received+v_line.quantity_received>v_line.quantity_ordered THEN
      RAISE EXCEPTION 'Receipt quantity exceeds the remaining ordered quantity for line %.',v_line.purchase_order_line_id;
    END IF;

    UPDATE public.purchase_order_lines
      SET quantity_received=quantity_received+v_line.quantity_received
      WHERE id=v_line.purchase_order_line_id AND organization_id=v_receipt.organization_id;

    -- Customer-mandate goods remain customer property and never enter company stock.
    IF v_line.purchase_purpose IN ('resale','company_use','consumption') THEN
      SELECT tracking_mode INTO v_tracking_mode FROM public.catalog_items
      WHERE id=v_line.item_id AND organization_id=v_receipt.organization_id;

      IF v_line.purchase_purpose='resale' AND v_tracking_mode='none' THEN
        RAISE EXCEPTION 'Goods acquired for resale must use quantity tracking.';
      END IF;
      IF v_tracking_mode='serial' THEN
        RAISE EXCEPTION 'Serial-tracked items require serial number capture, which is not enabled.';
      END IF;
      IF v_tracking_mode='quantity' THEN
        IF v_line.stock_location_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.stock_locations
          WHERE id=v_line.stock_location_id AND organization_id=v_receipt.organization_id AND is_active
        ) THEN RAISE EXCEPTION 'An active stock location is required for tracked item %.',v_line.item_id; END IF;

        INSERT INTO public.stock_movements(
          organization_id,item_id,stock_location_id,movement_kind,quantity_delta,
          unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by
        ) VALUES (
          v_receipt.organization_id,v_line.item_id,v_line.stock_location_id,'receipt',
          v_line.quantity_received,v_line.unit_cost,v_order.currency,
          'goods_receipt',v_receipt.id,v_line.id,'goods-receipt:'||v_line.id::text,
          v_receipt.received_at,auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.purchase_order_lines
    WHERE purchase_order_id=v_order.id AND organization_id=v_order.organization_id
      AND quantity_received<quantity_ordered
  ) INTO v_all_received;

  UPDATE public.purchase_orders
    SET status=CASE WHEN v_all_received THEN 'received' ELSE 'partially_received' END,updated_at=now()
    WHERE id=v_order.id AND organization_id=v_order.organization_id;

  UPDATE public.goods_receipts
    SET status='posted',posted_by=auth.uid(),posted_at=now()
    WHERE id=v_receipt.id AND organization_id=v_receipt.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION private.post_goods_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.post_goods_receipt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.post_goods_receipt(p_receipt_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path=pg_catalog,public,private
AS $$ SELECT private.post_goods_receipt(p_receipt_id); $$;
REVOKE ALL ON FUNCTION public.post_goods_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_goods_receipt(uuid) TO authenticated;

-- END CONSOLIDATED SOURCE: 20261110092048_commercial_items_procurement_stock_ledger.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110130000_procurement_line_adjustments.sql
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

-- END CONSOLIDATED SOURCE: 20261110130000_procurement_line_adjustments.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110131500_goods_receipt_request_idempotency.sql
-- Stable client request identity makes the server action retry-safe even when
-- a network retry reaches the action after the first request committed.
ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_org_request_key_uidx
  ON public.goods_receipts(organization_id,request_key)
  WHERE request_key IS NOT NULL;

-- END CONSOLIDATED SOURCE: 20261110131500_goods_receipt_request_idempotency.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110140000_stock_reservations_deliveries_transfers.sql
-- Operational stock subledger: reservations, deliveries and inter-location transfers.
-- All physical movements are append-only. The functions below are the only write path.
-- No accounting journal is created here: invoice/supplier-invoice posting remains separate.

CREATE UNIQUE INDEX IF NOT EXISTS orders_id_organization_uidx
  ON public.orders(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_lines_id_organization_uidx
  ON public.order_lines(id,organization_id);

ALTER TABLE public.quote_lines
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS item_id uuid;
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS delivered_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK(delivered_quantity>=0);
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS source_order_line_id uuid;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='quote_lines_item_org_fk') THEN
    ALTER TABLE public.quote_lines ADD CONSTRAINT quote_lines_item_org_fk
      FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='order_lines_item_org_fk') THEN
    ALTER TABLE public.order_lines ADD CONSTRAINT order_lines_item_org_fk
      FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='invoice_lines_item_org_fk') THEN
    ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_item_org_fk
      FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='invoice_lines_source_order_line_org_fk') THEN
    ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_source_order_line_org_fk
      FOREIGN KEY(source_order_line_id,organization_id) REFERENCES public.order_lines(id,organization_id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.quote_lines ADD CONSTRAINT quote_lines_line_kind_check
  CHECK(line_kind IN ('service','merchandise','equipment','consumable','fee','other')) NOT VALID;
ALTER TABLE public.order_lines ADD CONSTRAINT order_lines_line_kind_check
  CHECK(line_kind IN ('service','merchandise','equipment','consumable','fee','other')) NOT VALID;
ALTER TABLE public.invoice_lines ADD CONSTRAINT invoice_lines_line_kind_check
  CHECK(line_kind IN ('service','merchandise','equipment','consumable','fee','other')) NOT VALID;

CREATE TABLE public.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  quantity_reserved numeric(18,4) NOT NULL CHECK(quantity_reserved>0),
  quantity_fulfilled numeric(18,4) NOT NULL DEFAULT 0 CHECK(quantity_fulfilled>=0),
  quantity_released numeric(18,4) NOT NULL DEFAULT 0 CHECK(quantity_released>=0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','fulfilled','released','partially_fulfilled')),
  request_key uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_key),
  UNIQUE(id,organization_id),
  FOREIGN KEY(order_id,organization_id) REFERENCES public.orders(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(order_line_id,organization_id) REFERENCES public.order_lines(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  CHECK(quantity_fulfilled+quantity_released<=quantity_reserved)
);
CREATE INDEX stock_reservations_available_idx
  ON public.stock_reservations(organization_id,item_id,stock_location_id,status);

CREATE TABLE public.stock_reservation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 reservation_id uuid NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN ('release')),
 quantity numeric(18,4) NOT NULL CHECK(quantity>0),
 request_key uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_key),
 FOREIGN KEY(reservation_id,organization_id) REFERENCES public.stock_reservations(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE public.sales_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  delivery_number text NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
  request_key uuid NOT NULL,
  delivery_reference text,
  request_fingerprint text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,delivery_number),
  UNIQUE(organization_id,request_key),
  UNIQUE(id,organization_id),
  FOREIGN KEY(order_id,organization_id) REFERENCES public.orders(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE public.sales_delivery_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  delivery_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  reservation_id uuid,
  quantity_delivered numeric(18,4) NOT NULL CHECK(quantity_delivered>0),
  unit_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id),
  FOREIGN KEY(delivery_id,organization_id) REFERENCES public.sales_deliveries(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(order_line_id,organization_id) REFERENCES public.order_lines(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(reservation_id,organization_id) REFERENCES public.stock_reservations(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX sales_delivery_lines_order_line_idx ON public.sales_delivery_lines(organization_id,order_line_id);

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  transfer_number text NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  request_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
  reason text NOT NULL,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,transfer_number),
  UNIQUE(organization_id,request_key),
  UNIQUE(id,organization_id),
  FOREIGN KEY(source_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(destination_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  CHECK(source_location_id<>destination_location_id)
);
CREATE TABLE public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK(quantity>0),
  unit_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(transfer_id,organization_id) REFERENCES public.stock_transfers(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT
);

DO $rls$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['stock_reservations','stock_reservation_events','sales_deliveries','sales_delivery_lines','stock_transfers','stock_transfer_lines'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.is_org_member(organization_id))',t||'_org_select',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $rls$;

CREATE OR REPLACE VIEW public.stock_available
WITH(security_invoker=true)
AS
SELECT h.organization_id,h.item_id,h.stock_location_id,
       h.quantity_on_hand,
       COALESCE(r.quantity_reserved,0)::numeric(18,4) AS quantity_reserved,
       (h.quantity_on_hand-COALESCE(r.quantity_reserved,0))::numeric(18,4) AS quantity_available
FROM public.stock_on_hand h
LEFT JOIN (
 SELECT organization_id,item_id,stock_location_id,
        SUM(quantity_reserved-quantity_fulfilled-quantity_released) AS quantity_reserved
 FROM public.stock_reservations
 WHERE status IN ('active','partially_fulfilled')
 GROUP BY organization_id,item_id,stock_location_id
) r USING(organization_id,item_id,stock_location_id);
REVOKE ALL ON public.stock_available FROM PUBLIC,anon;
GRANT SELECT ON public.stock_available TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.reserve_stock(
 p_organization_id uuid,p_order_id uuid,p_order_line_id uuid,p_item_id uuid,
 p_stock_location_id uuid,p_quantity numeric,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.stock_reservations%rowtype; v_order public.orders%rowtype;
 v_line public.order_lines%rowtype; v_on_hand numeric; v_reserved numeric; v_line_reserved numeric; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Reservation quantity must be positive.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_item_id::text||':'||p_stock_location_id::text,0));
 SELECT * INTO v_existing FROM public.stock_reservations
 WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN
  IF v_existing.order_id<>p_order_id OR v_existing.order_line_id<>p_order_line_id OR v_existing.item_id<>p_item_id OR v_existing.stock_location_id<>p_stock_location_id OR v_existing.quantity_reserved<>p_quantity THEN
   RAISE EXCEPTION 'Idempotency key already used with different reservation data.';
  END IF;
  RETURN v_existing.id;
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not eligible for stock reservation.'; END IF;
 SELECT * INTO v_line FROM public.order_lines WHERE id=p_order_line_id AND order_id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_line.item_id IS DISTINCT FROM p_item_id OR v_line.line_kind NOT IN ('merchandise','equipment','consumable','other') THEN
  RAISE EXCEPTION 'Order line is not a matching stock item.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_stock_location_id AND organization_id=p_organization_id AND is_active) THEN
  RAISE EXCEPTION 'Stock location is inactive or outside the organization.';
 END IF;
 SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements
 WHERE organization_id=p_organization_id AND item_id=p_item_id AND stock_location_id=p_stock_location_id;
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
 FROM public.stock_reservations WHERE organization_id=p_organization_id AND item_id=p_item_id AND stock_location_id=p_stock_location_id
 AND status IN ('active','partially_fulfilled');
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_line_reserved
 FROM public.stock_reservations WHERE organization_id=p_organization_id AND order_line_id=p_order_line_id AND status IN ('active','partially_fulfilled');
 IF v_line_reserved+v_line.delivered_quantity+p_quantity>v_line.quantity+0.00000001 THEN RAISE EXCEPTION 'Reservation exceeds the remaining ordered quantity.'; END IF;
 IF v_on_hand-v_reserved<p_quantity THEN RAISE EXCEPTION 'Insufficient available stock. Available: %',v_on_hand-v_reserved; END IF;
 INSERT INTO public.stock_reservations(organization_id,order_id,order_line_id,item_id,stock_location_id,quantity_reserved,request_key,created_by)
 VALUES(p_organization_id,p_order_id,p_order_line_id,p_item_id,p_stock_location_id,p_quantity,p_request_key,auth.uid())
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.release_stock_reservation(p_organization_id uuid,p_reservation_id uuid,p_quantity numeric,p_request_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE r public.stock_reservations%rowtype; e public.stock_reservation_events%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':reservation-release:'||p_request_key::text,0));
 SELECT * INTO e FROM public.stock_reservation_events WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN
  IF e.reservation_id<>p_reservation_id OR e.quantity<>p_quantity OR e.event_kind<>'release' THEN RAISE EXCEPTION 'Release request key reused with different data.'; END IF;
  RETURN;
 END IF;
 SELECT * INTO r FROM public.stock_reservations WHERE id=p_reservation_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('active','partially_fulfilled') THEN RAISE EXCEPTION 'Active reservation not found.'; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>r.quantity_reserved-r.quantity_fulfilled-r.quantity_released THEN RAISE EXCEPTION 'Invalid release quantity.'; END IF;
 INSERT INTO public.stock_reservation_events(organization_id,reservation_id,event_kind,quantity,request_key,created_by)
 VALUES(p_organization_id,p_reservation_id,'release',p_quantity,p_request_key,auth.uid());
 UPDATE public.stock_reservations SET quantity_released=quantity_released+p_quantity,
 status=CASE WHEN quantity_fulfilled+quantity_released+p_quantity=quantity_reserved THEN 'released' ELSE 'partially_fulfilled' END,updated_at=now()
 WHERE id=r.id AND organization_id=p_organization_id;
END $$;

CREATE OR REPLACE FUNCTION private.post_sales_delivery(
 p_organization_id uuid,p_order_id uuid,p_lines jsonb,p_request_key uuid,p_delivery_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.sales_deliveries%rowtype; v_order public.orders%rowtype;
 r jsonb; v_delivery_id uuid; v_line_id uuid; v_order_line public.order_lines%rowtype;
 v_res public.stock_reservations%rowtype; v_item uuid; v_loc uuid; v_qty numeric; v_cost numeric;
 v_on_hand numeric; v_reserved numeric; v_already numeric; v_remaining numeric; v_line_reserved numeric; v_number text; v_fingerprint text; v_currency text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Delivery requires 1 to 100 lines.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':delivery:'||p_order_id::text,0));
 v_fingerprint:=md5(p_order_id::text||':'||p_lines::text||':'||COALESCE(p_delivery_reference,''));
 SELECT * INTO v_existing FROM public.sales_deliveries WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'Delivery request key reused with different payload.'; END IF; RETURN v_existing.id; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not eligible for delivery.'; END IF;
 SELECT currency INTO v_currency FROM public.organizations WHERE id=p_organization_id;
 v_delivery_id:=gen_random_uuid();
 v_number:='DL-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_delivery_id::text,'-',''),1,8));
 INSERT INTO public.sales_deliveries(id,organization_id,order_id,delivery_number,request_key,delivery_reference,request_fingerprint,created_by)
 VALUES(v_delivery_id,p_organization_id,p_order_id,v_number,p_request_key,nullif(trim(p_delivery_reference),''),v_fingerprint,auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(r->>'item_id')::uuid; v_loc:=(r->>'stock_location_id')::uuid;
  v_qty:=(r->>'quantity')::numeric; v_cost:=COALESCE((r->>'unit_cost')::numeric,0);
  IF v_qty<=0 OR v_cost<0 THEN RAISE EXCEPTION 'Invalid delivery quantity or cost.'; END IF;
  SELECT * INTO v_order_line FROM public.order_lines
  WHERE id=(r->>'order_line_id')::uuid AND order_id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_order_line.item_id IS DISTINCT FROM v_item OR v_order_line.line_kind NOT IN ('merchandise','equipment','consumable') THEN RAISE EXCEPTION 'Invalid stock order line.'; END IF;
  SELECT COALESCE(SUM(quantity_delivered),0) INTO v_already FROM public.sales_delivery_lines dl
  JOIN public.sales_deliveries d ON d.id=dl.delivery_id AND d.organization_id=dl.organization_id
  WHERE dl.organization_id=p_organization_id AND dl.order_line_id=v_order_line.id AND d.status='posted';
  v_remaining:=v_order_line.quantity-v_already;
  IF v_qty>v_remaining THEN RAISE EXCEPTION 'Delivery quantity exceeds remaining order quantity.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=v_loc AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Invalid stock location.'; END IF;
  v_line_id:=gen_random_uuid();
  INSERT INTO public.sales_delivery_lines(id,organization_id,delivery_id,order_line_id,item_id,stock_location_id,reservation_id,quantity_delivered,unit_cost)
  VALUES(v_line_id,p_organization_id,v_delivery_id,v_order_line.id,v_item,v_loc,nullif(r->>'reservation_id','')::uuid,v_qty,v_cost);
  IF nullif(r->>'reservation_id','') IS NOT NULL THEN
   SELECT * INTO v_res FROM public.stock_reservations WHERE id=(r->>'reservation_id')::uuid AND organization_id=p_organization_id FOR UPDATE;
   IF NOT FOUND OR v_res.order_id<>p_order_id OR v_res.order_line_id<>v_order_line.id OR v_res.item_id<>v_item OR v_res.stock_location_id<>v_loc OR v_res.status NOT IN ('active','partially_fulfilled') OR v_qty>v_res.quantity_reserved-v_res.quantity_fulfilled-v_res.quantity_released THEN
    RAISE EXCEPTION 'Reservation does not cover this delivery.';
   END IF;
   UPDATE public.stock_reservations SET quantity_fulfilled=quantity_fulfilled+v_qty,
    status=CASE WHEN quantity_fulfilled+v_qty+quantity_released=quantity_reserved THEN 'fulfilled' ELSE 'partially_fulfilled' END,updated_at=now()
    WHERE id=v_res.id AND organization_id=p_organization_id;
  ELSE
   SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_line_reserved
   FROM public.stock_reservations WHERE organization_id=p_organization_id AND order_line_id=v_order_line.id
     AND status IN ('active','partially_fulfilled');
   IF v_qty>v_remaining-v_line_reserved THEN RAISE EXCEPTION 'Delivery exceeds the unreserved remainder of this order line.'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_item::text||':'||v_loc::text,0));
   SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=v_loc;
   SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved FROM public.stock_reservations
   WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=v_loc AND status IN ('active','partially_fulfilled');
   IF v_on_hand-v_reserved<v_qty THEN RAISE EXCEPTION 'Insufficient unreserved stock for delivery.'; END IF;
  END IF;
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_organization_id,v_item,v_loc,'issue',-v_qty,v_cost,COALESCE(v_currency,'MGA'),'sales_delivery',v_delivery_id,v_line_id,'sales-delivery:'||v_line_id::text,now(),auth.uid());
  UPDATE public.order_lines SET delivered_quantity=delivered_quantity+v_qty WHERE id=v_order_line.id AND organization_id=p_organization_id;
 END LOOP;
 RETURN v_delivery_id;
END $$;

CREATE OR REPLACE FUNCTION private.post_stock_transfer(
 p_organization_id uuid,p_source_location uuid,p_destination_location uuid,p_lines jsonb,p_request_key uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.stock_transfers%rowtype; v_id uuid; v_number text; r jsonb;
 v_item uuid; v_qty numeric; v_cost numeric; v_on_hand numeric; v_reserved numeric; v_line uuid; v_fingerprint text; v_currency text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'inventory.manage');
 IF p_source_location=p_destination_location OR nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Transfer locations and reason are invalid.'; END IF;
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Transfer requires 1 to 100 lines.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':transfer:'||p_request_key::text,0));
 v_fingerprint:=md5(p_source_location::text||':'||p_destination_location::text||':'||p_lines::text||':'||p_reason);
 SELECT * INTO v_existing FROM public.stock_transfers WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'Transfer request key reused with different payload.'; END IF; RETURN v_existing.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_source_location AND organization_id=p_organization_id AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_destination_location AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Transfer location is invalid.'; END IF;
 SELECT currency INTO v_currency FROM public.organizations WHERE id=p_organization_id;
 v_id:=gen_random_uuid();v_number:='TR-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
 INSERT INTO public.stock_transfers(id,organization_id,transfer_number,source_location_id,destination_location_id,request_key,request_fingerprint,reason,created_by)
 VALUES(v_id,p_organization_id,v_number,p_source_location,p_destination_location,p_request_key,v_fingerprint,trim(p_reason),auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(r->>'item_id')::uuid;v_qty:=(r->>'quantity')::numeric;v_cost:=COALESCE((r->>'unit_cost')::numeric,0);
  IF v_qty<=0 OR v_cost<0 THEN RAISE EXCEPTION 'Invalid transfer quantity or cost.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_item::text||':'||p_source_location::text,0));
  SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location;
  SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved FROM public.stock_reservations
  WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location AND status IN ('active','partially_fulfilled');
  IF v_on_hand-v_reserved<v_qty THEN RAISE EXCEPTION 'Insufficient available stock for transfer.'; END IF;
  v_line:=gen_random_uuid();
  INSERT INTO public.stock_transfer_lines(id,organization_id,transfer_id,item_id,quantity,unit_cost)
  VALUES(v_line,p_organization_id,v_id,v_item,v_qty,v_cost);
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_organization_id,v_item,p_source_location,'transfer_out',-v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-out:'||v_line::text,now(),auth.uid()),
        (p_organization_id,v_item,p_destination_location,'transfer_in',v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-in:'||v_line::text,now(),auth.uid());
 END LOOP;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_stock(
 p_organization_id uuid,p_order_id uuid,p_order_line_id uuid,p_item_id uuid,
 p_stock_location_id uuid,p_quantity numeric,p_request_key uuid
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.reserve_stock($1,$2,$3,$4,$5,$6,$7); $$;
CREATE OR REPLACE FUNCTION public.release_stock_reservation(p_organization_id uuid,p_reservation_id uuid,p_quantity numeric,p_request_key uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.release_stock_reservation($1,$2,$3,$4); $$;
CREATE OR REPLACE FUNCTION public.post_sales_delivery(
 p_organization_id uuid,p_order_id uuid,p_lines jsonb,p_request_key uuid,p_delivery_reference text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.post_sales_delivery($1,$2,$3,$4,$5); $$;
CREATE OR REPLACE FUNCTION public.post_stock_transfer(
 p_organization_id uuid,p_source_location uuid,p_destination_location uuid,p_lines jsonb,p_request_key uuid,p_reason text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.post_stock_transfer($1,$2,$3,$4,$5,$6); $$;

REVOKE ALL ON FUNCTION private.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.release_stock_reservation(uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.post_sales_delivery(uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.release_stock_reservation(uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_sales_delivery(uuid,uuid,jsonb,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.release_stock_reservation(uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_sales_delivery(uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_stock_reservation(uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sales_delivery(uuid,uuid,jsonb,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.add_catalog_item_to_order(
 p_organization_id uuid,p_order_id uuid,p_item_id uuid,p_quantity numeric,
 p_unit_price numeric,p_tax_rate numeric,p_discount_pct numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_order public.orders%rowtype; v_item public.catalog_items%rowtype;
 v_line_id uuid; v_gross numeric; v_discount numeric; v_taxable numeric; v_tax numeric; v_total numeric; v_kind text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF p_quantity IS NULL OR p_quantity<=0 OR p_unit_price IS NULL OR p_unit_price<0 OR p_tax_rate IS NULL OR p_tax_rate NOT BETWEEN 0 AND 100 OR p_discount_pct IS NULL OR p_discount_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Invalid item order line amounts.';
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not open for item lines.'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoices WHERE order_id=p_order_id AND organization_id=p_organization_id AND status<>'cancelled')
 OR EXISTS(SELECT 1 FROM public.sales_deliveries WHERE order_id=p_order_id AND organization_id=p_organization_id AND status='posted') THEN
  RAISE EXCEPTION 'Order lines cannot be added after invoicing or delivery has started.';
 END IF;
 SELECT * INTO v_item FROM public.catalog_items WHERE id=p_item_id AND organization_id=p_organization_id AND is_active;
 IF NOT FOUND OR v_item.tracking_mode<>'quantity' THEN RAISE EXCEPTION 'Active quantity-tracked catalogue item required.'; END IF;
 v_kind:=CASE v_item.item_kind WHEN 'merchandise' THEN 'merchandise' WHEN 'equipment' THEN 'equipment' WHEN 'consumable' THEN 'consumable' ELSE 'other' END;
 v_gross:=round(p_quantity*p_unit_price,2);
 v_discount:=round(v_gross*p_discount_pct/100,2);
 v_taxable:=v_gross-v_discount;
 v_tax:=round(v_taxable*p_tax_rate/100,2);
 v_total:=v_taxable+v_tax;
 INSERT INTO public.order_lines(organization_id,order_id,service_id,item_id,line_kind,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount,delivered_quantity)
 VALUES(p_organization_id,p_order_id,NULL,p_item_id,v_kind,v_item.name,p_quantity,v_item.base_unit,p_unit_price,p_tax_rate,v_total,
 COALESCE((SELECT max(sort_order)+1 FROM public.order_lines WHERE organization_id=p_organization_id AND order_id=p_order_id),0),
 p_discount_pct,v_discount,v_taxable,0)
 RETURNING id INTO v_line_id;
 UPDATE public.orders o SET
  subtotal=COALESCE((SELECT SUM(round(ol.quantity*ol.unit_price-ol.discount_amount,2)) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  tax_total=COALESCE((SELECT SUM(round((ol.quantity*ol.unit_price-ol.discount_amount)*ol.tax_rate/100,2)) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  total=COALESCE((SELECT SUM(ol.line_total) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  updated_at=now()
 WHERE o.id=p_order_id AND o.organization_id=p_organization_id;
 PERFORM public.audit_event(p_organization_id,'order.catalog_item_added','order',p_order_id,NULL,jsonb_build_object('order_line_id',v_line_id,'item_id',p_item_id,'quantity',p_quantity,'line_total',v_total));
 RETURN v_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.add_catalog_item_to_order(
 p_organization_id uuid,p_order_id uuid,p_item_id uuid,p_quantity numeric,
 p_unit_price numeric,p_tax_rate numeric,p_discount_pct numeric
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.add_catalog_item_to_order($1,$2,$3,$4,$5,$6,$7); $$;
REVOKE ALL ON FUNCTION private.add_catalog_item_to_order(uuid,uuid,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.add_catalog_item_to_order(uuid,uuid,uuid,numeric,numeric,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.add_catalog_item_to_order(uuid,uuid,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_catalog_item_to_order(uuid,uuid,uuid,numeric,numeric,numeric,numeric) TO authenticated;

-- END CONSOLIDATED SOURCE: 20261110140000_stock_reservations_deliveries_transfers.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110150000_stock_buckets_and_moving_average_accounting.sql
-- Distinguish company stock by purpose and use a moving weighted average cost per item/location/bucket.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS stock_bucket text NOT NULL DEFAULT 'resale';
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_stock_bucket_check
  CHECK(stock_bucket IN ('resale','company_use','consumption')) NOT VALID;
UPDATE public.stock_movements m
SET stock_bucket=CASE pol.purchase_purpose
  WHEN 'resale' THEN 'resale'
  WHEN 'company_use' THEN 'company_use'
  WHEN 'consumption' THEN 'consumption'
  ELSE m.stock_bucket END
FROM public.goods_receipt_lines grl
JOIN public.purchase_order_lines pol
  ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
WHERE m.source_type='goods_receipt' AND m.source_line_id=grl.id AND m.organization_id=grl.organization_id;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_stock_bucket_check;

ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS stock_bucket text NOT NULL DEFAULT 'resale';
ALTER TABLE public.stock_reservations
  ADD CONSTRAINT stock_reservations_resale_bucket_check CHECK(stock_bucket='resale') NOT VALID;
ALTER TABLE public.stock_reservations VALIDATE CONSTRAINT stock_reservations_resale_bucket_check;

ALTER TABLE public.stock_transfer_lines
  ADD COLUMN IF NOT EXISTS stock_bucket text NOT NULL DEFAULT 'resale';
ALTER TABLE public.stock_transfer_lines
  ADD CONSTRAINT stock_transfer_lines_bucket_check CHECK(stock_bucket IN ('resale','company_use','consumption')) NOT VALID;
ALTER TABLE public.stock_transfer_lines VALIDATE CONSTRAINT stock_transfer_lines_bucket_check;

CREATE OR REPLACE FUNCTION private.assign_stock_movement_bucket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private
AS $$
DECLARE v_bucket text;
BEGIN
 IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
  SELECT CASE pol.purchase_purpose
   WHEN 'resale' THEN 'resale' WHEN 'company_use' THEN 'company_use' WHEN 'consumption' THEN 'consumption' ELSE NULL END
  INTO v_bucket
  FROM public.goods_receipt_lines grl
  JOIN public.purchase_order_lines pol ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
  WHERE grl.id=NEW.source_line_id AND grl.organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Cannot classify company-owned receipt into a stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='stock_transfer' THEN
  SELECT stock_bucket INTO v_bucket FROM public.stock_transfer_lines
  WHERE id=NEW.source_line_id AND organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Stock transfer line is missing its stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='sales_delivery' THEN
  NEW.stock_bucket:='resale';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_movements_assign_bucket ON public.stock_movements;
CREATE TRIGGER stock_movements_assign_bucket
BEFORE INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION private.assign_stock_movement_bucket();

CREATE OR REPLACE VIEW public.stock_on_hand_by_bucket
WITH(security_invoker=true)
AS
SELECT organization_id,item_id,stock_location_id,stock_bucket,
       SUM(quantity_delta)::numeric(18,4) AS quantity_on_hand
FROM public.stock_movements
GROUP BY organization_id,item_id,stock_location_id,stock_bucket;

DROP VIEW public.stock_available;
CREATE VIEW public.stock_available
WITH(security_invoker=true)
AS
SELECT h.organization_id,h.item_id,h.stock_location_id,h.stock_bucket,
       h.quantity_on_hand,
       CASE WHEN h.stock_bucket='resale' THEN COALESCE(r.quantity_reserved,0)::numeric(18,4) ELSE 0::numeric(18,4) END AS quantity_reserved,
       (h.quantity_on_hand-CASE WHEN h.stock_bucket='resale' THEN COALESCE(r.quantity_reserved,0) ELSE 0 END)::numeric(18,4) AS quantity_available
FROM public.stock_on_hand_by_bucket h
LEFT JOIN (
 SELECT organization_id,item_id,stock_location_id,
        SUM(quantity_reserved-quantity_fulfilled-quantity_released) AS quantity_reserved
 FROM public.stock_reservations
 WHERE stock_bucket='resale' AND status IN ('active','partially_fulfilled')
 GROUP BY organization_id,item_id,stock_location_id
) r ON r.organization_id=h.organization_id AND r.item_id=h.item_id AND r.stock_location_id=h.stock_location_id;
REVOKE ALL ON public.stock_available FROM PUBLIC,anon;
GRANT SELECT ON public.stock_available TO authenticated,service_role;
GRANT SELECT ON public.stock_on_hand_by_bucket TO authenticated,service_role;

-- PCG 2005 accounts used by the perpetual inventory and merchandise revenue workflows.
INSERT INTO public.pcg2005_accounts(code,label,kind,source)
VALUES
 ('603','Variation de stocks (approvisionnements et marchandises)','expense','PCG 2005 Madagascar'),
 ('707','Ventes de marchandises','income','PCG 2005 Madagascar')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE public.accounting_posting_rules DROP CONSTRAINT IF EXISTS accounting_posting_rules_operation_type_check;
ALTER TABLE public.accounting_posting_rules ADD CONSTRAINT accounting_posting_rules_operation_type_check
CHECK(operation_type IN ('expense','customer_payment','supplier_payment','internal_transfer','transaction_fee','customer_refund','supplier_refund','advance','invoice','stock_receipt','stock_issue'));
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority,valid_from)
VALUES
 ('stock_receipt','recognition','merchandise_stock','37',NULL,100,current_date),
 ('stock_receipt','recognition','stock_variation',NULL,'603',100,current_date),
 ('stock_issue','recognition','stock_variation','603',NULL,100,current_date),
 ('stock_issue','recognition','merchandise_stock',NULL,'37',100,current_date)
ON CONFLICT DO NOTHING;

CREATE TABLE public.accounting_event_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 source_type text NOT NULL,
 source_id uuid NOT NULL,
 event_type text NOT NULL,
 operation_type text NOT NULL,
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','posted')),
 journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 attempted_at timestamptz,
 posted_at timestamptz,
 UNIQUE(organization_id,source_type,source_id,event_type)
);
ALTER TABLE public.accounting_event_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_event_outbox FROM PUBLIC,anon;
CREATE POLICY accounting_event_outbox_org_select ON public.accounting_event_outbox
 FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
GRANT SELECT ON public.accounting_event_outbox TO authenticated;
GRANT ALL ON public.accounting_event_outbox TO service_role;

CREATE OR REPLACE FUNCTION private.process_stock_accounting_event(p_organization_id uuid,p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE e public.accounting_event_outbox%rowtype; v_amount numeric; v_debit text; v_credit text; v_lines jsonb; v_journal uuid;
BEGIN
 SELECT * INTO e FROM public.accounting_event_outbox
 WHERE id=p_event_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accounting event not found in this organization.'; END IF;
 IF e.status='posted' THEN RETURN e.journal_entry_id; END IF;
 v_amount:=round(COALESCE((e.payload->>'amount')::numeric,0),2);
 IF v_amount<=0 THEN
  UPDATE public.accounting_event_outbox SET status='posted',last_error=NULL,attempted_at=now(),posted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN NULL;
 END IF;
 BEGIN
  IF e.operation_type='stock_receipt' THEN
   v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','merchandise_stock','debit');
   v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','stock_variation','credit');
  ELSIF e.operation_type='stock_issue' THEN
   v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','stock_variation','debit');
   v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','merchandise_stock','credit');
  ELSE
   RAISE EXCEPTION 'Unsupported stock accounting event type.';
  END IF;
  v_lines:=jsonb_build_array(
   jsonb_build_object('pcg_code',v_debit,'debit',v_amount,'credit',0),
   jsonb_build_object('pcg_code',v_credit,'debit',0,'credit',v_amount)
  );
  v_journal:=public.magnisa_post_journal(
   e.organization_id,(e.payload->>'effective_at')::timestamptz::date,
   'STK-'||upper(substr(replace(e.source_id::text,'-',''),1,12)),
   CASE WHEN e.operation_type='stock_receipt' THEN 'Entrée en stock de marchandises' ELSE 'Sortie de stock liée à une livraison client' END,
   'stock_movement',e.source_id,v_lines
  );
  UPDATE public.accounting_event_outbox SET status='posted',journal_entry_id=v_journal,last_error=NULL,attempted_at=now(),posted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN v_journal;
 EXCEPTION WHEN OTHERS THEN
  UPDATE public.accounting_event_outbox SET status='pending',last_error=SQLERRM,attempted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN NULL;
 END;
END $$;

CREATE OR REPLACE FUNCTION public.process_stock_accounting_event(p_organization_id uuid,p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,private,auth
AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'accounting.manage');
 RETURN private.process_stock_accounting_event(p_organization_id,p_event_id);
END $$;
REVOKE ALL ON FUNCTION private.process_stock_accounting_event(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.process_stock_accounting_event(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.process_stock_accounting_event(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.process_stock_accounting_event(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.post_stock_movement_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_operation text; v_amount numeric; v_event_id uuid;
BEGIN
 IF NEW.stock_bucket<>'resale' THEN RETURN NEW; END IF;
 IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
  v_operation:='stock_receipt'; v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
 ELSIF NEW.source_type='sales_delivery' AND NEW.movement_kind='issue' THEN
  v_operation:='stock_issue'; v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
 ELSE
  RETURN NEW;
 END IF;
 INSERT INTO public.accounting_event_outbox(organization_id,source_type,source_id,event_type,operation_type,payload)
 VALUES(NEW.organization_id,'stock_movement',NEW.id,v_operation,v_operation,
  jsonb_build_object('movement_id',NEW.id,'item_id',NEW.item_id,'stock_location_id',NEW.stock_location_id,
    'stock_bucket',NEW.stock_bucket,'quantity',abs(NEW.quantity_delta),'unit_cost',NEW.unit_cost,
    'amount',v_amount,'effective_at',NEW.effective_at))
 ON CONFLICT(organization_id,source_type,source_id,event_type) DO NOTHING
 RETURNING id INTO v_event_id;
 IF v_event_id IS NULL THEN
  SELECT id INTO v_event_id FROM public.accounting_event_outbox
  WHERE organization_id=NEW.organization_id AND source_type='stock_movement' AND source_id=NEW.id AND event_type=v_operation;
 END IF;
 PERFORM private.process_stock_accounting_event(NEW.organization_id,v_event_id);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stock_movements_accounting_post ON public.stock_movements;
CREATE TRIGGER stock_movements_accounting_post
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION private.post_stock_movement_accounting();

CREATE OR REPLACE FUNCTION private.reserve_stock(
 p_organization_id uuid,p_order_id uuid,p_order_line_id uuid,p_item_id uuid,
 p_stock_location_id uuid,p_quantity numeric,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.stock_reservations%rowtype; v_order public.orders%rowtype;
 v_line public.order_lines%rowtype; v_on_hand numeric; v_reserved numeric; v_line_reserved numeric; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF p_quantity IS NULL OR p_quantity<=0 THEN RAISE EXCEPTION 'Reservation quantity must be positive.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_item_id::text||':'||p_stock_location_id::text,0));
 SELECT * INTO v_existing FROM public.stock_reservations
 WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN
  IF v_existing.order_id<>p_order_id OR v_existing.order_line_id<>p_order_line_id OR v_existing.item_id<>p_item_id OR v_existing.stock_location_id<>p_stock_location_id OR v_existing.quantity_reserved<>p_quantity THEN
   RAISE EXCEPTION 'Idempotency key already used with different reservation data.';
  END IF;
  RETURN v_existing.id;
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not eligible for stock reservation.'; END IF;
 SELECT * INTO v_line FROM public.order_lines WHERE id=p_order_line_id AND order_id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_line.item_id IS DISTINCT FROM p_item_id OR v_line.line_kind NOT IN ('merchandise','equipment','consumable','other') THEN
  RAISE EXCEPTION 'Order line is not a matching stock item.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_stock_location_id AND organization_id=p_organization_id AND is_active) THEN
  RAISE EXCEPTION 'Stock location is inactive or outside the organization.';
 END IF;
 SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements
 WHERE organization_id=p_organization_id AND item_id=p_item_id AND stock_location_id=p_stock_location_id AND stock_bucket='resale';
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
 FROM public.stock_reservations WHERE organization_id=p_organization_id AND item_id=p_item_id AND stock_location_id=p_stock_location_id
 AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_line_reserved
 FROM public.stock_reservations WHERE organization_id=p_organization_id AND order_line_id=p_order_line_id AND status IN ('active','partially_fulfilled');
 IF v_line_reserved+v_line.delivered_quantity+p_quantity>v_line.quantity+0.00000001 THEN RAISE EXCEPTION 'Reservation exceeds the remaining ordered quantity.'; END IF;
 IF v_on_hand-v_reserved<p_quantity THEN RAISE EXCEPTION 'Insufficient available stock. Available: %',v_on_hand-v_reserved; END IF;
 INSERT INTO public.stock_reservations(organization_id,order_id,order_line_id,item_id,stock_location_id,quantity_reserved,request_key,created_by)
 VALUES(p_organization_id,p_order_id,p_order_line_id,p_item_id,p_stock_location_id,p_quantity,p_request_key,auth.uid())
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.post_sales_delivery(
 p_organization_id uuid,p_order_id uuid,p_lines jsonb,p_request_key uuid,p_delivery_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.sales_deliveries%rowtype; v_order public.orders%rowtype;
 r jsonb; v_delivery_id uuid; v_line_id uuid; v_order_line public.order_lines%rowtype;
 v_res public.stock_reservations%rowtype; v_item uuid; v_loc uuid; v_qty numeric; v_cost numeric;
 v_on_hand numeric; v_reserved numeric; v_already numeric; v_remaining numeric; v_line_reserved numeric; v_stock_value numeric; v_number text; v_fingerprint text; v_currency text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Delivery requires 1 to 100 lines.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':delivery:'||p_order_id::text,0));
 v_fingerprint:=md5(p_order_id::text||':'||p_lines::text||':'||COALESCE(p_delivery_reference,''));
 SELECT * INTO v_existing FROM public.sales_deliveries WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'Delivery request key reused with different payload.'; END IF; RETURN v_existing.id; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not eligible for delivery.'; END IF;
 SELECT currency INTO v_currency FROM public.organizations WHERE id=p_organization_id;
 v_delivery_id:=gen_random_uuid();
 v_number:='DL-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_delivery_id::text,'-',''),1,8));
 INSERT INTO public.sales_deliveries(id,organization_id,order_id,delivery_number,request_key,delivery_reference,request_fingerprint,created_by)
 VALUES(v_delivery_id,p_organization_id,p_order_id,v_number,p_request_key,nullif(trim(p_delivery_reference),''),v_fingerprint,auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(r->>'item_id')::uuid; v_loc:=(r->>'stock_location_id')::uuid;
  v_qty:=(r->>'quantity')::numeric; v_cost:=0;
  IF v_qty<=0 THEN RAISE EXCEPTION 'Invalid delivery quantity.'; END IF;
  SELECT * INTO v_order_line FROM public.order_lines
  WHERE id=(r->>'order_line_id')::uuid AND order_id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_order_line.item_id IS DISTINCT FROM v_item OR v_order_line.line_kind NOT IN ('merchandise','equipment','consumable','other') THEN RAISE EXCEPTION 'Invalid stock order line.'; END IF;
  SELECT COALESCE(SUM(quantity_delivered),0) INTO v_already FROM public.sales_delivery_lines dl
  JOIN public.sales_deliveries d ON d.id=dl.delivery_id AND d.organization_id=dl.organization_id
  WHERE dl.organization_id=p_organization_id AND dl.order_line_id=v_order_line.id AND d.status='posted';
  v_remaining:=v_order_line.quantity-v_already;
  IF v_qty>v_remaining THEN RAISE EXCEPTION 'Delivery quantity exceeds remaining order quantity.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=v_loc AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Invalid stock location.'; END IF;
  SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(quantity_delta*unit_cost),0)
  INTO v_on_hand,v_stock_value FROM public.stock_movements
  WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=v_loc AND stock_bucket='resale';
  IF v_on_hand<=0 OR v_on_hand+0.00000001<v_qty THEN RAISE EXCEPTION 'Insufficient resale stock at the selected location.'; END IF;
  v_cost:=round(v_stock_value/v_on_hand,2);
  v_line_id:=gen_random_uuid();
  INSERT INTO public.sales_delivery_lines(id,organization_id,delivery_id,order_line_id,item_id,stock_location_id,reservation_id,quantity_delivered,unit_cost)
  VALUES(v_line_id,p_organization_id,v_delivery_id,v_order_line.id,v_item,v_loc,nullif(r->>'reservation_id','')::uuid,v_qty,v_cost);
  IF nullif(r->>'reservation_id','') IS NOT NULL THEN
   SELECT * INTO v_res FROM public.stock_reservations WHERE id=(r->>'reservation_id')::uuid AND organization_id=p_organization_id FOR UPDATE;
   IF NOT FOUND OR v_res.order_id<>p_order_id OR v_res.order_line_id<>v_order_line.id OR v_res.item_id<>v_item OR v_res.stock_location_id<>v_loc OR v_res.status NOT IN ('active','partially_fulfilled') OR v_qty>v_res.quantity_reserved-v_res.quantity_fulfilled-v_res.quantity_released THEN
    RAISE EXCEPTION 'Reservation does not cover this delivery.';
   END IF;
   UPDATE public.stock_reservations SET quantity_fulfilled=quantity_fulfilled+v_qty,
    status=CASE WHEN quantity_fulfilled+v_qty+quantity_released=quantity_reserved THEN 'fulfilled' ELSE 'partially_fulfilled' END,updated_at=now()
    WHERE id=v_res.id AND organization_id=p_organization_id;
  ELSE
   SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_line_reserved
   FROM public.stock_reservations WHERE organization_id=p_organization_id AND order_line_id=v_order_line.id
     AND status IN ('active','partially_fulfilled');
   IF v_qty>v_remaining-v_line_reserved THEN RAISE EXCEPTION 'Delivery exceeds the unreserved remainder of this order line.'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_item::text||':'||v_loc::text,0));
   SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=v_loc AND stock_bucket='resale';
   SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved FROM public.stock_reservations
   WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=v_loc AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
   IF v_on_hand-v_reserved<v_qty THEN RAISE EXCEPTION 'Insufficient unreserved stock for delivery.'; END IF;
  END IF;
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_organization_id,v_item,v_loc,'resale','issue',-v_qty,v_cost,COALESCE(v_currency,'MGA'),'sales_delivery',v_delivery_id,v_line_id,'sales-delivery:'||v_line_id::text,now(),auth.uid());
  UPDATE public.order_lines SET delivered_quantity=delivered_quantity+v_qty WHERE id=v_order_line.id AND organization_id=p_organization_id;
 END LOOP;
 RETURN v_delivery_id;
END $$;

CREATE OR REPLACE FUNCTION private.post_stock_transfer(
 p_organization_id uuid,p_source_location uuid,p_destination_location uuid,p_lines jsonb,p_request_key uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.stock_transfers%rowtype; v_id uuid; v_number text; r jsonb;
 v_item uuid; v_qty numeric; v_cost numeric; v_on_hand numeric; v_reserved numeric; v_line uuid; v_fingerprint text; v_currency text; v_bucket text; v_stock_value numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'inventory.manage');
 IF p_source_location=p_destination_location OR nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Transfer locations and reason are invalid.'; END IF;
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Transfer requires 1 to 100 lines.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':transfer:'||p_request_key::text,0));
 v_fingerprint:=md5(p_source_location::text||':'||p_destination_location::text||':'||p_lines::text||':'||p_reason);
 SELECT * INTO v_existing FROM public.stock_transfers WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'Transfer request key reused with different payload.'; END IF; RETURN v_existing.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_source_location AND organization_id=p_organization_id AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_destination_location AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Transfer location is invalid.'; END IF;
 SELECT currency INTO v_currency FROM public.organizations WHERE id=p_organization_id;
 v_id:=gen_random_uuid();v_number:='TR-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
 INSERT INTO public.stock_transfers(id,organization_id,transfer_number,source_location_id,destination_location_id,request_key,request_fingerprint,reason,created_by)
 VALUES(v_id,p_organization_id,v_number,p_source_location,p_destination_location,p_request_key,v_fingerprint,trim(p_reason),auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(r->>'item_id')::uuid;v_qty:=(r->>'quantity')::numeric;v_bucket:=COALESCE(NULLIF(r->>'stock_bucket',''),'resale');
  IF v_qty<=0 OR v_bucket NOT IN ('resale','company_use','consumption') THEN RAISE EXCEPTION 'Invalid transfer quantity or stock bucket.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_item::text||':'||p_source_location::text,0));
  SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(quantity_delta*unit_cost),0) INTO v_on_hand,v_stock_value FROM public.stock_movements WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location AND stock_bucket=v_bucket;
  SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved FROM public.stock_reservations
  WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location AND stock_bucket=v_bucket AND status IN ('active','partially_fulfilled');
  IF v_on_hand-v_reserved<v_qty THEN RAISE EXCEPTION 'Insufficient available stock for transfer.'; END IF;
  v_cost:=CASE WHEN v_on_hand>0 THEN round(v_stock_value/v_on_hand,2) ELSE 0 END;
  v_line:=gen_random_uuid();
  INSERT INTO public.stock_transfer_lines(id,organization_id,transfer_id,item_id,stock_bucket,quantity,unit_cost)
  VALUES(v_line,p_organization_id,v_id,v_item,v_bucket,v_qty,v_cost);
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_organization_id,v_item,p_source_location,v_bucket,'transfer_out',-v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-out:'||v_line::text,now(),auth.uid()),
        (p_organization_id,v_item,p_destination_location,v_bucket,'transfer_in',v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-in:'||v_line::text,now(),auth.uid());
 END LOOP;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.add_catalog_item_to_order(
 p_organization_id uuid,p_order_id uuid,p_item_id uuid,p_quantity numeric,
 p_unit_price numeric,p_tax_rate numeric,p_discount_pct numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_order public.orders%rowtype; v_item public.catalog_items%rowtype;
 v_line_id uuid; v_gross numeric; v_discount numeric; v_taxable numeric; v_tax numeric; v_total numeric; v_kind text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 IF p_quantity IS NULL OR p_quantity<=0 OR p_unit_price IS NULL OR p_unit_price<0 OR p_tax_rate IS NULL OR p_tax_rate NOT BETWEEN 0 AND 100 OR p_discount_pct IS NULL OR p_discount_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Invalid item order line amounts.';
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR v_order.status NOT IN ('confirmed','in_progress') THEN RAISE EXCEPTION 'Order is not open for item lines.'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoices WHERE order_id=p_order_id AND organization_id=p_organization_id AND status<>'cancelled')
 OR EXISTS(SELECT 1 FROM public.sales_deliveries WHERE order_id=p_order_id AND organization_id=p_organization_id AND status='posted') THEN
  RAISE EXCEPTION 'Order lines cannot be added after invoicing or delivery has started.';
 END IF;
 SELECT * INTO v_item FROM public.catalog_items WHERE id=p_item_id AND organization_id=p_organization_id AND is_active;
 IF NOT FOUND OR v_item.tracking_mode<>'quantity' THEN RAISE EXCEPTION 'Active quantity-tracked catalogue item required.'; END IF;
 -- A catalog item is a commercial good when sold; its physical item_kind remains separate.
 v_kind:='merchandise';
 v_gross:=round(p_quantity*p_unit_price,2);
 v_discount:=round(v_gross*p_discount_pct/100,2);
 v_taxable:=v_gross-v_discount;
 v_tax:=round(v_taxable*p_tax_rate/100,2);
 v_total:=v_taxable+v_tax;
 INSERT INTO public.order_lines(organization_id,order_id,service_id,item_id,line_kind,description,quantity,unit,unit_price,tax_rate,line_total,sort_order,discount_pct,discount_amount,taxable_amount,delivered_quantity)
 VALUES(p_organization_id,p_order_id,NULL,p_item_id,v_kind,v_item.name,p_quantity,v_item.base_unit,p_unit_price,p_tax_rate,v_total,
 COALESCE((SELECT max(sort_order)+1 FROM public.order_lines WHERE organization_id=p_organization_id AND order_id=p_order_id),0),
 p_discount_pct,v_discount,v_taxable,0)
 RETURNING id INTO v_line_id;
 UPDATE public.orders o SET
  subtotal=COALESCE((SELECT SUM(round(ol.quantity*ol.unit_price-ol.discount_amount,2)) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  tax_total=COALESCE((SELECT SUM(round((ol.quantity*ol.unit_price-ol.discount_amount)*ol.tax_rate/100,2)) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  total=COALESCE((SELECT SUM(ol.line_total) FROM public.order_lines ol WHERE ol.organization_id=p_organization_id AND ol.order_id=p_order_id),0),
  updated_at=now()
 WHERE o.id=p_order_id AND o.organization_id=p_organization_id;
 PERFORM public.audit_event(p_organization_id,'order.catalog_item_added','order',p_order_id,NULL,jsonb_build_object('order_line_id',v_line_id,'item_id',p_item_id,'quantity',p_quantity,'line_total',v_total));
 RETURN v_line_id;
END $$;

-- END CONSOLIDATED SOURCE: 20261110150000_stock_buckets_and_moving_average_accounting.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110160000_mixed_service_merchandise_invoicing.sql
-- Mixed service / merchandise billing from delivered order quantities.
-- Revenue is posted by line nature through the versioned accounting rules.
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority,valid_from)
VALUES
 ('invoice','recognition','customer_receivable','411',NULL,100,current_date),
 ('invoice','recognition','service_revenue',NULL,'706',100,current_date),
 ('invoice','recognition','merchandise_revenue',NULL,'707',100,current_date),
 ('invoice','recognition','ancillary_revenue',NULL,'708',100,current_date),
 ('invoice','recognition','tax_payable',NULL,'445',100,current_date)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(
 p_org uuid,p_customer uuid,p_due_date date,p_lines jsonb,p_order uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
 v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;ol public.order_lines%rowtype;
 v_order public.orders%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;
 v_description text;v_unit text;v_kind text;v_item uuid;v_order_line_id uuid;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;
 v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
 v_billed numeric;v_remaining numeric;v_seen_order_lines uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_due_date IS NULL OR p_due_date<current_date THEN RAISE EXCEPTION 'Échéance invalide'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>100 THEN
  RAISE EXCEPTION 'La facture doit contenir entre 1 et 100 lignes';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND is_active) THEN
  RAISE EXCEPTION 'Client invalide';
 END IF;
 IF p_order IS NOT NULL THEN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id<>p_customer OR v_order.status NOT IN ('confirmed','in_progress','completed') THEN
   RAISE EXCEPTION 'Commande ou client invalide';
  END IF;
 END IF;

 -- Validate all lines and remaining quantities before creating the invoice header.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=COALESCE((r->>'quantity')::numeric,0);
  d:=COALESCE((r->>'discount_pct')::numeric,0);
  v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF q<=0 OR d<0 OR d>100 THEN RAISE EXCEPTION 'Ligne de facture invalide'; END IF;

  IF v_kind='service' THEN
   IF NULLIF(r->>'service_id','') IS NULL THEN RAISE EXCEPTION 'Prestation manquante'; END IF;
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestation invalide'; END IF;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   IF unit_price<0 THEN RAISE EXCEPTION 'Prix unitaire invalide'; END IF;
   tax_rate:=s.tax_rate;v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF p_order IS NOT NULL THEN
    IF v_order_line_id IS NULL OR v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Chaque prestation d’une commande doit être rattachée une seule fois à sa ligne source'; END IF;
    SELECT * INTO ol FROM public.order_lines
     WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order AND service_id=s.id AND line_kind='service' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de prestation source invalide'; END IF;
    SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
     FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
     WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
    v_remaining:=ol.quantity-v_billed;
    IF q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse le reliquat de la prestation'; END IF;
    tax_rate:=ol.tax_rate;v_description:=ol.description;v_unit:=ol.unit;
    v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
   ELSIF v_order_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne source fournie sans commande';
   END IF;
  ELSIF v_kind='merchandise' THEN
   IF p_order IS NULL OR v_order_line_id IS NULL OR NULLIF(r->>'item_id','') IS NULL THEN
    RAISE EXCEPTION 'Une marchandise doit provenir d’une ligne de commande client';
   END IF;
   IF v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Une ligne de commande ne peut apparaître qu’une fois par facture'; END IF;
   SELECT * INTO ol FROM public.order_lines
    WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order
      AND item_id=(r->>'item_id')::uuid AND line_kind='merchandise' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de marchandise source invalide'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
   v_remaining:=ol.delivered_quantity-v_billed;
   IF v_remaining<=0 OR q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse les marchandises effectivement livrées et non encore facturées'; END IF;
   unit_price:=ol.unit_price;d:=ol.discount_pct;tax_rate:=ol.tax_rate;
   v_description:=ol.description;v_unit:=ol.unit;v_item:=ol.item_id;
   v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
  ELSE
   RAISE EXCEPTION 'Nature de ligne de facture non prise en charge';
  END IF;

  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 END LOOP;

 v_number:=public.next_document_number(p_org,'invoice');
 INSERT INTO public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
 VALUES(p_org,p_customer,p_order,v_number,'draft',current_date,p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid())
 RETURNING id INTO v_invoice;

 -- Rebuild the validated snapshot and persist the mixed invoice lines.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=(r->>'quantity')::numeric;v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF v_kind='service' THEN
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   d:=COALESCE((r->>'discount_pct')::numeric,0);tax_rate:=s.tax_rate;
   v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF v_order_line_id IS NOT NULL THEN
    SELECT source_line.tax_rate,source_line.description,source_line.unit INTO tax_rate,v_description,v_unit FROM public.order_lines source_line
    WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order AND source_line.service_id=s.id;
   END IF;
  ELSE
   SELECT source_line.unit_price,source_line.discount_pct,source_line.tax_rate,source_line.description,source_line.unit,source_line.item_id
    INTO unit_price,d,tax_rate,v_description,v_unit,v_item
   FROM public.order_lines source_line WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order;
  END IF;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  INSERT INTO public.invoice_lines(organization_id,invoice_id,service_id,item_id,line_kind,source_order_line_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  VALUES(p_org,v_invoice,CASE WHEN v_kind='service' THEN s.id ELSE NULL END,v_item,v_kind,v_order_line_id,
    v_description,q,v_unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);
  v_sort:=v_sort+1;
 END LOOP;
 PERFORM public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,NULL,
  jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));
 RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_org uuid,p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE i public.invoices%rowtype; r record; v_lines jsonb; v_key text; v_account text; v_order_line public.order_lines%rowtype; v_billed numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.issue');
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 IF i.status<>'draft' THEN RAISE EXCEPTION 'Seule une facture brouillon peut être émise'; END IF;
 IF i.total<=0 THEN RAISE EXCEPTION 'Total invalide'; END IF;

 -- Revalidate delivery and remaining order quantities immediately before posting.
 FOR r IN SELECT * FROM public.invoice_lines WHERE organization_id=p_org AND invoice_id=i.id LOOP
  IF r.source_order_line_id IS NOT NULL THEN
   SELECT * INTO v_order_line FROM public.order_lines WHERE id=r.source_order_line_id AND organization_id=p_org FOR UPDATE;
   IF NOT FOUND OR v_order_line.order_id IS DISTINCT FROM i.order_id THEN RAISE EXCEPTION 'Ligne de commande source introuvable ou étrangère à la commande de la facture'; END IF;
   IF r.line_kind='service' AND v_order_line.service_id IS DISTINCT FROM r.service_id THEN RAISE EXCEPTION 'Prestation source incohérente'; END IF;
   IF r.line_kind='merchandise' AND v_order_line.item_id IS DISTINCT FROM r.item_id THEN RAISE EXCEPTION 'Marchandise source incohérente'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=r.source_order_line_id
      AND il.invoice_id<>i.id AND inv.status<>'cancelled';
   IF r.line_kind='merchandise' AND r.quantity>v_order_line.delivered_quantity-v_billed+0.00000001 THEN
    RAISE EXCEPTION 'Une marchandise de la facture n’est plus intégralement livrée ou disponible à facturer';
   ELSIF r.line_kind='service' AND r.quantity>v_order_line.quantity-v_billed+0.00000001 THEN
    RAISE EXCEPTION 'Une prestation de la facture dépasse le reliquat de commande';
   END IF;
  ELSIF r.line_kind='merchandise' THEN
   RAISE EXCEPTION 'Une marchandise doit rester rattachée à une commande client';
  END IF;
 END LOOP;

 v_lines:=jsonb_build_array(jsonb_build_object(
  'pcg_code',public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','customer_receivable','debit'),
  'debit',i.total,'credit',0,'customer_id',i.customer_id
 ));
 FOR r IN
  SELECT CASE
    WHEN line_kind='service' THEN 'service_revenue'
    WHEN line_kind='fee' THEN 'ancillary_revenue'
    WHEN item_id IS NOT NULL OR line_kind IN ('merchandise','equipment','consumable') THEN 'merchandise_revenue'
    ELSE 'ancillary_revenue'
   END AS operation_key,
   SUM(taxable_amount) AS amount
  FROM public.invoice_lines
  WHERE organization_id=p_org AND invoice_id=i.id
  GROUP BY 1
 LOOP
  IF r.amount>0 THEN
   v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition',r.operation_key,'credit');
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'pcg_code',v_account,'debit',0,'credit',r.amount,'customer_id',i.customer_id
   ));
  END IF;
 END LOOP;
 IF i.tax_total>0 THEN
  v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','tax_payable','credit');
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
   'pcg_code',v_account,'debit',0,'credit',i.tax_total,'customer_id',i.customer_id
  ));
 END IF;

 UPDATE public.invoices SET status='issued',issued_at=now(),balance_due=total-paid_amount,updated_at=now()
 WHERE id=i.id AND organization_id=p_org;
 PERFORM public.magnisa_post_journal(p_org,i.issue_date,i.number,'Émission facture '||i.number,'invoice',i.id,v_lines);
 PERFORM public.audit_event(p_org,'invoice.issued','invoice',i.id,jsonb_build_object('status','draft'),jsonb_build_object('status','issued'));
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_invoice_line(p_org uuid,p_line uuid,p_quantity numeric,p_discount_pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE l public.invoice_lines%rowtype;ol public.order_lines%rowtype;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;inv uuid;billed numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_quantity IS NULL OR p_quantity<=0 OR p_discount_pct IS NULL OR p_discount_pct<0 OR p_discount_pct>100 THEN
  RAISE EXCEPTION 'Quantité ou remise invalide';
 END IF;
 SELECT * INTO l FROM public.invoice_lines WHERE id=p_line AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de facture introuvable'; END IF;
 IF l.line_kind<>'service' THEN RAISE EXCEPTION 'Les lignes de marchandises sont figées sur le prix et la quantité de la commande livrée'; END IF;
 inv:=l.invoice_id;
 IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=inv AND organization_id=p_org AND status='draft') THEN
  RAISE EXCEPTION 'Seule une facture brouillon peut être modifiée';
 END IF;
 IF l.source_order_line_id IS NOT NULL THEN
  SELECT * INTO ol FROM public.order_lines WHERE id=l.source_order_line_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande source introuvable'; END IF;
  SELECT COALESCE(SUM(il.quantity),0) INTO billed
   FROM public.invoice_lines il JOIN public.invoices i ON i.id=il.invoice_id AND i.organization_id=il.organization_id
   WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND il.invoice_id<>inv AND i.status<>'cancelled';
  IF p_quantity>ol.quantity-billed+0.00000001 THEN RAISE EXCEPTION 'La quantité dépasse le reliquat de prestation non facturé'; END IF;
 END IF;
 gross:=round(p_quantity*l.unit_price,2);disc:=round(gross*p_discount_pct/100,2);taxable:=gross-disc;
 tax:=round(taxable*l.tax_rate/100,2);total:=taxable+tax;
 UPDATE public.invoice_lines SET quantity=p_quantity,discount_pct=p_discount_pct,discount_amount=disc,taxable_amount=taxable,tax_amount=tax,line_total=total
 WHERE id=l.id AND organization_id=p_org;
 UPDATE public.invoices i SET subtotal=x.subtotal,discount_total=x.discount_total,tax_total=x.tax_total,total=x.total,balance_due=x.total-i.paid_amount,updated_at=now()
 FROM (SELECT invoice_id,sum(taxable_amount) subtotal,sum(discount_amount) discount_total,sum(tax_amount) tax_total,sum(line_total) total
       FROM public.invoice_lines WHERE invoice_id=inv GROUP BY invoice_id) x
 WHERE i.id=inv AND i.organization_id=p_org;
END;
$function$;

-- END CONSOLIDATED SOURCE: 20261110160000_mixed_service_merchandise_invoicing.sql

-- BEGIN CONSOLIDATED SOURCE: 20261110170000_stock_returns_adjustments_and_compensations.sql
-- Controlled returns, compensating cancellations, inventory adjustments and as-of balances.
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_stock_bucket_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_stock_bucket_check
 CHECK(stock_bucket IN ('resale','company_use','consumption','quarantine'));
ALTER TABLE public.stock_transfer_lines DROP CONSTRAINT stock_transfer_lines_bucket_check;
ALTER TABLE public.stock_transfer_lines ADD CONSTRAINT stock_transfer_lines_bucket_check
 CHECK(stock_bucket IN ('resale','company_use','consumption','quarantine'));

ALTER TABLE public.stock_transfers ADD COLUMN cancellation_request_key uuid;
ALTER TABLE public.stock_transfers ADD COLUMN cancellation_reason text;
ALTER TABLE public.stock_transfers ADD COLUMN cancelled_at timestamptz;
CREATE UNIQUE INDEX stock_transfers_cancel_request_uidx ON public.stock_transfers(organization_id,cancellation_request_key) WHERE cancellation_request_key IS NOT NULL;
ALTER TABLE public.sales_deliveries ADD COLUMN cancellation_request_key uuid;
ALTER TABLE public.sales_deliveries ADD COLUMN cancellation_reason text;
ALTER TABLE public.sales_deliveries ADD COLUMN cancelled_at timestamptz;
CREATE UNIQUE INDEX sales_deliveries_cancel_request_uidx ON public.sales_deliveries(organization_id,cancellation_request_key) WHERE cancellation_request_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_lines_id_organization_uidx ON public.invoice_lines(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_id_organization_uidx ON public.stock_movements(id,organization_id);

CREATE TABLE public.stock_returns(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 return_number text NOT NULL,
 return_type text NOT NULL CHECK(return_type IN ('customer','supplier')),
 source_document_id uuid NOT NULL,
 request_key uuid NOT NULL,
 reason text NOT NULL,
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 posted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,return_number),UNIQUE(organization_id,request_key),UNIQUE(id,organization_id)
);
CREATE TABLE public.stock_return_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 return_id uuid NOT NULL,
 source_line_type text NOT NULL CHECK(source_line_type IN ('sales_delivery_line','goods_receipt_line')),
 source_line_id uuid NOT NULL,
 source_invoice_line_id uuid,
 item_id uuid NOT NULL,
 stock_location_id uuid NOT NULL,
 quantity numeric(18,4) NOT NULL CHECK(quantity>0),
 return_condition text NOT NULL CHECK(return_condition IN ('resalable','quarantine','damaged','supplier_return')),
 stock_bucket text NOT NULL CHECK(stock_bucket IN ('resale','company_use','consumption','quarantine')),
 unit_cost numeric(18,2) NOT NULL CHECK(unit_cost>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,return_id,source_line_type,source_line_id),
 FOREIGN KEY(return_id,organization_id) REFERENCES public.stock_returns(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_invoice_line_id,organization_id) REFERENCES public.invoice_lines(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE public.stock_adjustments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 adjustment_number text NOT NULL,
 request_key uuid NOT NULL,
 reason text NOT NULL,
 evidence_reference text,
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 posted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,adjustment_number),UNIQUE(organization_id,request_key),UNIQUE(id,organization_id)
);
CREATE TABLE public.stock_adjustment_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 adjustment_id uuid NOT NULL,
 item_id uuid NOT NULL,
 stock_location_id uuid NOT NULL,
 stock_bucket text NOT NULL CHECK(stock_bucket IN ('resale','company_use','consumption','quarantine')),
 quantity_delta numeric(18,4) NOT NULL CHECK(quantity_delta<>0),
 unit_cost numeric(18,2) NOT NULL CHECK(unit_cost>=0),
 movement_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(adjustment_id,organization_id) REFERENCES public.stock_adjustments(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
 FOREIGN KEY(movement_id,organization_id) REFERENCES public.stock_movements(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX stock_returns_source_line_idx ON public.stock_return_lines(organization_id,source_line_type,source_line_id);
CREATE INDEX stock_adjustment_lines_item_idx ON public.stock_adjustment_lines(organization_id,item_id,stock_location_id);

ALTER TABLE public.stock_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_returns,public.stock_return_lines,public.stock_adjustments,public.stock_adjustment_lines FROM PUBLIC,anon;
CREATE POLICY stock_returns_org_select ON public.stock_returns FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
CREATE POLICY stock_return_lines_org_select ON public.stock_return_lines FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
CREATE POLICY stock_adjustments_org_select ON public.stock_adjustments FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
CREATE POLICY stock_adjustment_lines_org_select ON public.stock_adjustment_lines FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
GRANT SELECT ON public.stock_returns,public.stock_return_lines,public.stock_adjustments,public.stock_adjustment_lines TO authenticated;
GRANT ALL ON public.stock_returns,public.stock_return_lines,public.stock_adjustments,public.stock_adjustment_lines TO service_role;

DROP VIEW public.stock_available;
CREATE VIEW public.stock_available WITH(security_invoker=true) AS
SELECT h.organization_id,h.item_id,h.stock_location_id,h.stock_bucket,h.quantity_on_hand,
 CASE WHEN h.stock_bucket='resale' THEN COALESCE(r.quantity_reserved,0)::numeric(18,4) ELSE 0::numeric(18,4) END quantity_reserved,
 CASE WHEN h.stock_bucket='quarantine' THEN 0::numeric(18,4)
      ELSE (h.quantity_on_hand-CASE WHEN h.stock_bucket='resale' THEN COALESCE(r.quantity_reserved,0) ELSE 0 END)::numeric(18,4) END quantity_available
FROM public.stock_on_hand_by_bucket h
LEFT JOIN (
 SELECT organization_id,item_id,stock_location_id,SUM(quantity_reserved-quantity_fulfilled-quantity_released) quantity_reserved
 FROM public.stock_reservations WHERE stock_bucket='resale' AND status IN ('active','partially_fulfilled')
 GROUP BY organization_id,item_id,stock_location_id
) r ON r.organization_id=h.organization_id AND r.item_id=h.item_id AND r.stock_location_id=h.stock_location_id;
REVOKE ALL ON public.stock_available FROM PUBLIC,anon;
GRANT SELECT ON public.stock_available TO authenticated,service_role;

ALTER TABLE public.accounting_posting_rules DROP CONSTRAINT accounting_posting_rules_operation_type_check;
ALTER TABLE public.accounting_posting_rules ADD CONSTRAINT accounting_posting_rules_operation_type_check
 CHECK(operation_type IN ('expense','customer_payment','supplier_payment','internal_transfer','transaction_fee','customer_refund','supplier_refund','advance','invoice','stock_receipt','stock_issue','stock_return','stock_supplier_return','stock_adjustment_in','stock_adjustment_out'));
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority,valid_from)
VALUES
 ('stock_return','recognition','merchandise_stock','37',NULL,100,current_date),
 ('stock_return','recognition','stock_variation',NULL,'603',100,current_date),
 ('stock_supplier_return','recognition','stock_variation','603',NULL,100,current_date),
 ('stock_supplier_return','recognition','merchandise_stock',NULL,'37',100,current_date),
 ('stock_adjustment_in','recognition','merchandise_stock','37',NULL,100,current_date),
 ('stock_adjustment_in','recognition','stock_variation',NULL,'603',100,current_date),
 ('stock_adjustment_out','recognition','stock_variation','603',NULL,100,current_date),
 ('stock_adjustment_out','recognition','merchandise_stock',NULL,'37',100,current_date)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION private.assign_stock_movement_bucket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private
AS $$
DECLARE v_bucket text;
BEGIN
 IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
  SELECT CASE pol.purchase_purpose
   WHEN 'resale' THEN 'resale' WHEN 'company_use' THEN 'company_use' WHEN 'consumption' THEN 'consumption' ELSE NULL END
  INTO v_bucket
  FROM public.goods_receipt_lines grl
  JOIN public.purchase_order_lines pol ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
  WHERE grl.id=NEW.source_line_id AND grl.organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Cannot classify company-owned receipt into a stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='stock_transfer' THEN
  SELECT stock_bucket INTO v_bucket FROM public.stock_transfer_lines
  WHERE id=NEW.source_line_id AND organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Stock transfer line is missing its stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='sales_delivery' OR NEW.source_type='delivery_cancel' THEN
  NEW.stock_bucket:='resale';
 ELSIF NEW.source_type IN ('customer_return','supplier_return') THEN
  SELECT stock_bucket INTO v_bucket FROM public.stock_return_lines
  WHERE id=NEW.source_line_id AND organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Stock return line is missing its stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='stock_adjustment' THEN
  SELECT stock_bucket INTO v_bucket FROM public.stock_adjustment_lines
  WHERE id=NEW.source_line_id AND organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Stock adjustment line is missing its stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 ELSIF NEW.source_type='stock_transfer_cancel' THEN
  SELECT stock_bucket INTO v_bucket FROM public.stock_transfer_lines
  WHERE id=NEW.source_line_id AND organization_id=NEW.organization_id;
  IF v_bucket IS NULL THEN RAISE EXCEPTION 'Stock transfer cancellation line is missing its stock bucket.'; END IF;
  NEW.stock_bucket:=v_bucket;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.process_stock_accounting_event(p_organization_id uuid,p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE e public.accounting_event_outbox%rowtype; v_amount numeric; v_debit text; v_credit text; v_lines jsonb; v_journal uuid;
BEGIN
 SELECT * INTO e FROM public.accounting_event_outbox
 WHERE id=p_event_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accounting event not found in this organization.'; END IF;
 IF e.status='posted' THEN RETURN e.journal_entry_id; END IF;
 v_amount:=round(COALESCE((e.payload->>'amount')::numeric,0),2);
 IF v_amount<=0 THEN
  UPDATE public.accounting_event_outbox SET status='posted',last_error=NULL,attempted_at=now(),posted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN NULL;
 END IF;
 BEGIN
  IF e.operation_type IN ('stock_receipt','stock_return','stock_adjustment_in') THEN
   v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','merchandise_stock','debit');
   v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','stock_variation','credit');
  ELSIF e.operation_type IN ('stock_issue','stock_supplier_return','stock_adjustment_out') THEN
   v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','stock_variation','debit');
   v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','merchandise_stock','credit');
  ELSE
   RAISE EXCEPTION 'Unsupported stock accounting event type.';
  END IF;
  v_lines:=jsonb_build_array(
   jsonb_build_object('pcg_code',v_debit,'debit',v_amount,'credit',0),
   jsonb_build_object('pcg_code',v_credit,'debit',0,'credit',v_amount)
  );
  v_journal:=public.magnisa_post_journal(
   e.organization_id,(e.payload->>'effective_at')::timestamptz::date,
   'STK-'||upper(substr(replace(e.source_id::text,'-',''),1,12)),
   CASE WHEN e.operation_type='stock_receipt' THEN 'Entrée en stock de marchandises' ELSE 'Sortie de stock liée à une livraison client' END,
   'stock_movement',e.source_id,v_lines
  );
  UPDATE public.accounting_event_outbox SET status='posted',journal_entry_id=v_journal,last_error=NULL,attempted_at=now(),posted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN v_journal;
 EXCEPTION WHEN OTHERS THEN
  UPDATE public.accounting_event_outbox SET status='pending',last_error=SQLERRM,attempted_at=now()
  WHERE id=e.id AND organization_id=e.organization_id;
  RETURN NULL;
 END;
END $$;

CREATE OR REPLACE FUNCTION private.post_stock_movement_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_operation text; v_amount numeric; v_event_id uuid;
BEGIN
 IF NEW.stock_bucket NOT IN ('resale','quarantine') THEN RETURN NEW; END IF;
 IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
  v_operation:='stock_receipt'; v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
 ELSIF NEW.source_type='sales_delivery' AND NEW.movement_kind='issue' THEN
  v_operation:='stock_issue'; v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
 ELSIF NEW.source_type IN ('customer_return','delivery_cancel') AND NEW.movement_kind IN ('customer_return','adjustment_in') THEN
  v_operation:='stock_return'; v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
 ELSIF NEW.source_type='supplier_return' AND NEW.movement_kind='supplier_return' THEN
  v_operation:='stock_supplier_return'; v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
 ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_in' THEN
  v_operation:='stock_adjustment_in'; v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
 ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_out' THEN
  v_operation:='stock_adjustment_out'; v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
 ELSE
  RETURN NEW;
 END IF;
 INSERT INTO public.accounting_event_outbox(organization_id,source_type,source_id,event_type,operation_type,payload)
 VALUES(NEW.organization_id,'stock_movement',NEW.id,v_operation,v_operation,
  jsonb_build_object('movement_id',NEW.id,'item_id',NEW.item_id,'stock_location_id',NEW.stock_location_id,
    'stock_bucket',NEW.stock_bucket,'quantity',abs(NEW.quantity_delta),'unit_cost',NEW.unit_cost,
    'amount',v_amount,'effective_at',NEW.effective_at))
 ON CONFLICT(organization_id,source_type,source_id,event_type) DO NOTHING
 RETURNING id INTO v_event_id;
 IF v_event_id IS NULL THEN
  SELECT id INTO v_event_id FROM public.accounting_event_outbox
  WHERE organization_id=NEW.organization_id AND source_type='stock_movement' AND source_id=NEW.id AND event_type=v_operation;
 END IF;
 PERFORM private.process_stock_accounting_event(NEW.organization_id,v_event_id);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.post_stock_transfer(
 p_organization_id uuid,p_source_location uuid,p_destination_location uuid,p_lines jsonb,p_request_key uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE v_existing public.stock_transfers%rowtype; v_id uuid; v_number text; r jsonb;
 v_item uuid; v_qty numeric; v_cost numeric; v_on_hand numeric; v_reserved numeric; v_line uuid; v_fingerprint text; v_currency text; v_bucket text; v_stock_value numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'inventory.manage');
 IF p_source_location=p_destination_location OR nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Transfer locations and reason are invalid.'; END IF;
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 OR jsonb_array_length(p_lines)>100 THEN RAISE EXCEPTION 'Transfer requires 1 to 100 lines.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':transfer:'||p_request_key::text,0));
 v_fingerprint:=md5(p_source_location::text||':'||p_destination_location::text||':'||p_lines::text||':'||p_reason);
 SELECT * INTO v_existing FROM public.stock_transfers WHERE organization_id=p_organization_id AND request_key=p_request_key;
 IF FOUND THEN IF v_existing.request_fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'Transfer request key reused with different payload.'; END IF; RETURN v_existing.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_source_location AND organization_id=p_organization_id AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_destination_location AND organization_id=p_organization_id AND is_active) THEN RAISE EXCEPTION 'Transfer location is invalid.'; END IF;
 SELECT currency INTO v_currency FROM public.organizations WHERE id=p_organization_id;
 v_id:=gen_random_uuid();v_number:='TR-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
 INSERT INTO public.stock_transfers(id,organization_id,transfer_number,source_location_id,destination_location_id,request_key,request_fingerprint,reason,created_by)
 VALUES(v_id,p_organization_id,v_number,p_source_location,p_destination_location,p_request_key,v_fingerprint,trim(p_reason),auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_item:=(r->>'item_id')::uuid;v_qty:=(r->>'quantity')::numeric;v_bucket:=COALESCE(NULLIF(r->>'stock_bucket',''),'resale');
  IF v_qty<=0 OR v_bucket NOT IN ('resale','company_use','consumption','quarantine') THEN RAISE EXCEPTION 'Invalid transfer quantity or stock bucket.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_item::text||':'||p_source_location::text,0));
  SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(quantity_delta*unit_cost),0) INTO v_on_hand,v_stock_value FROM public.stock_movements WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location AND stock_bucket=v_bucket;
  SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved FROM public.stock_reservations
  WHERE organization_id=p_organization_id AND item_id=v_item AND stock_location_id=p_source_location AND stock_bucket=v_bucket AND status IN ('active','partially_fulfilled');
  IF v_on_hand-v_reserved<v_qty THEN RAISE EXCEPTION 'Insufficient available stock for transfer.'; END IF;
  v_cost:=CASE WHEN v_on_hand>0 THEN round(v_stock_value/v_on_hand,2) ELSE 0 END;
  v_line:=gen_random_uuid();
  INSERT INTO public.stock_transfer_lines(id,organization_id,transfer_id,item_id,stock_bucket,quantity,unit_cost)
  VALUES(v_line,p_organization_id,v_id,v_item,v_bucket,v_qty,v_cost);
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_organization_id,v_item,p_source_location,v_bucket,'transfer_out',-v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-out:'||v_line::text,now(),auth.uid()),
        (p_organization_id,v_item,p_destination_location,v_bucket,'transfer_in',v_qty,v_cost,COALESCE(v_currency,'MGA'),'stock_transfer',v_id,v_line,'stock-transfer-in:'||v_line::text,now(),auth.uid());
 END LOOP;
 RETURN v_id;
END $$;


CREATE OR REPLACE FUNCTION public.post_customer_stock_return(
 p_org uuid,p_delivery_line_id uuid,p_location_id uuid,p_quantity numeric,
 p_condition text,p_request_key uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE dl public.sales_delivery_lines%rowtype;v_delivery public.sales_deliveries%rowtype;
 v_bucket text;v_return uuid;v_line uuid;v_number text;v_cost numeric;v_returned numeric;v_invoice_line uuid;v_existing public.stock_returns%rowtype;
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.manage');
 IF p_quantity<=0 OR p_reason IS NULL OR length(trim(p_reason))<3 OR p_condition NOT IN ('resalable','quarantine','damaged') THEN RAISE EXCEPTION 'Paramètres de retour client invalides'; END IF;
 SELECT * INTO v_existing FROM public.stock_returns WHERE organization_id=p_org AND request_key=p_request_key;
 IF FOUND THEN
  SELECT * INTO dl FROM public.sales_delivery_lines WHERE id=p_delivery_line_id AND organization_id=p_org;
  IF NOT FOUND OR v_existing.return_type<>'customer' THEN RAISE EXCEPTION 'Clé de retour déjà utilisée'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stock_return_lines WHERE return_id=v_existing.id AND organization_id=p_org
    AND source_line_id=p_delivery_line_id AND quantity=p_quantity AND return_condition=p_condition AND stock_location_id=p_location_id) THEN
   RAISE EXCEPTION 'Clé de retour réutilisée avec des paramètres différents';
  END IF;
  RETURN v_existing.id;
 END IF;
 SELECT * INTO dl FROM public.sales_delivery_lines WHERE id=p_delivery_line_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de livraison introuvable'; END IF;
 SELECT * INTO v_delivery FROM public.sales_deliveries WHERE id=dl.delivery_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR v_delivery.status<>'posted' THEN RAISE EXCEPTION 'La livraison source n’est pas active'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_location_id AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'Emplacement de retour invalide'; END IF;
 IF EXISTS(SELECT 1 FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
  WHERE il.organization_id=p_org AND il.source_order_line_id=dl.order_line_id AND inv.status='draft') THEN
  RAISE EXCEPTION 'Annule le brouillon de facture avant d’enregistrer un retour client';
 END IF;
 SELECT COALESCE(SUM(rl.quantity),0) INTO v_returned
 FROM public.stock_return_lines rl JOIN public.stock_returns sr ON sr.id=rl.return_id AND sr.organization_id=rl.organization_id
 WHERE rl.organization_id=p_org AND rl.source_line_type='sales_delivery_line' AND rl.source_line_id=dl.id
   AND sr.return_type='customer' AND sr.status='posted';
 IF p_quantity>dl.quantity_delivered-v_returned+0.00000001 THEN RAISE EXCEPTION 'Le retour dépasse la quantité livrée non encore retournée'; END IF;
 v_bucket:=CASE WHEN p_condition='resalable' THEN 'resale' ELSE 'quarantine' END;
 v_cost:=dl.unit_cost;
 SELECT il.id INTO v_invoice_line FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
 WHERE il.organization_id=p_org AND il.source_order_line_id=dl.order_line_id AND inv.status IN ('issued','partially_paid','paid')
 ORDER BY inv.issue_date DESC,il.sort_order DESC LIMIT 1;
 v_return:=gen_random_uuid();v_line:=gen_random_uuid();
 v_number:='CR-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_return::text,'-',''),1,8));
 INSERT INTO public.stock_returns(id,organization_id,return_number,return_type,source_document_id,request_key,reason,created_by)
 VALUES(v_return,p_org,v_number,'customer',dl.delivery_id,p_request_key,trim(p_reason),auth.uid());
 INSERT INTO public.stock_return_lines(id,organization_id,return_id,source_line_type,source_line_id,source_invoice_line_id,item_id,stock_location_id,quantity,return_condition,stock_bucket,unit_cost)
 VALUES(v_line,p_org,v_return,'sales_delivery_line',dl.id,v_invoice_line,dl.item_id,p_location_id,p_quantity,p_condition,v_bucket,v_cost);
 INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
 VALUES(p_org,dl.item_id,p_location_id,v_bucket,'customer_return',p_quantity,v_cost,'MGA','customer_return',v_return,v_line,'customer-return:'||v_line::text,now(),auth.uid());
 PERFORM public.audit_event(p_org,'stock.customer_return_posted','stock_return',v_return,NULL,jsonb_build_object('delivery_line_id',dl.id,'quantity',p_quantity,'condition',p_condition,'bucket',v_bucket));
 RETURN v_return;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_supplier_stock_return(
 p_org uuid,p_receipt_line_id uuid,p_location_id uuid,p_quantity numeric,p_request_key uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE grl public.goods_receipt_lines%rowtype;gr public.goods_receipts%rowtype;pol public.purchase_order_lines%rowtype;
 v_bucket text;v_cost numeric;v_returned numeric;v_on_hand numeric;v_reserved numeric;v_return uuid;v_line uuid;v_number text;v_existing public.stock_returns%rowtype;
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.manage');
 IF p_quantity<=0 OR p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Paramètres de retour fournisseur invalides'; END IF;
 SELECT * INTO v_existing FROM public.stock_returns WHERE organization_id=p_org AND request_key=p_request_key;
 IF FOUND THEN
  IF v_existing.return_type<>'supplier' OR NOT EXISTS(SELECT 1 FROM public.stock_return_lines WHERE return_id=v_existing.id AND organization_id=p_org
    AND source_line_type='goods_receipt_line' AND source_line_id=p_receipt_line_id AND quantity=p_quantity AND stock_location_id=p_location_id) THEN
   RAISE EXCEPTION 'Clé de retour réutilisée avec des paramètres différents';
  END IF;
  RETURN v_existing.id;
 END IF;
 SELECT * INTO grl FROM public.goods_receipt_lines WHERE id=p_receipt_line_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de réception fournisseur introuvable'; END IF;
 SELECT * INTO gr FROM public.goods_receipts WHERE id=grl.goods_receipt_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR gr.status<>'posted' THEN RAISE EXCEPTION 'La réception source n’est pas validée'; END IF;
 SELECT * INTO pol FROM public.purchase_order_lines WHERE id=grl.purchase_order_line_id AND organization_id=p_org;
 IF NOT FOUND OR pol.purchase_purpose='customer_mandate' THEN RAISE EXCEPTION 'Un achat sous mandat ne constitue pas un stock appartenant à l’entreprise'; END IF;
 SELECT stock_bucket INTO v_bucket FROM public.stock_movements
 WHERE organization_id=p_org AND source_type='goods_receipt' AND source_line_id=grl.id AND movement_kind='receipt' LIMIT 1;
 IF v_bucket IS NULL THEN RAISE EXCEPTION 'Mouvement d’entrée d’origine introuvable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_location_id AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'Emplacement de retour invalide'; END IF;
 SELECT COALESCE(SUM(rl.quantity),0) INTO v_returned
 FROM public.stock_return_lines rl JOIN public.stock_returns sr ON sr.id=rl.return_id AND sr.organization_id=rl.organization_id
 WHERE rl.organization_id=p_org AND rl.source_line_type='goods_receipt_line' AND rl.source_line_id=grl.id
   AND sr.return_type='supplier' AND sr.status='posted';
 IF p_quantity>grl.quantity_received-v_returned+0.00000001 THEN RAISE EXCEPTION 'Le retour dépasse la quantité reçue non encore retournée'; END IF;
 SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(quantity_delta*unit_cost),0) INTO v_on_hand,v_cost FROM public.stock_movements
 WHERE organization_id=p_org AND item_id=pol.item_id AND stock_location_id=p_location_id AND stock_bucket=v_bucket;
 IF v_on_hand<=0 THEN RAISE EXCEPTION 'Aucun stock physique à retourner depuis cet emplacement'; END IF;
 v_cost:=round(v_cost/v_on_hand,2);
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
 FROM public.stock_reservations WHERE organization_id=p_org AND item_id=pol.item_id AND stock_location_id=p_location_id
 AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
 IF v_on_hand-v_reserved+0.00000001<p_quantity THEN RAISE EXCEPTION 'Stock physique disponible insuffisant pour le retour fournisseur'; END IF;
 v_return:=gen_random_uuid();v_line:=gen_random_uuid();
 v_number:='SR-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_return::text,'-',''),1,8));
 INSERT INTO public.stock_returns(id,organization_id,return_number,return_type,source_document_id,request_key,reason,created_by)
 VALUES(v_return,p_org,v_number,'supplier',gr.id,p_request_key,trim(p_reason),auth.uid());
 INSERT INTO public.stock_return_lines(id,organization_id,return_id,source_line_type,source_line_id,item_id,stock_location_id,quantity,return_condition,stock_bucket,unit_cost)
 VALUES(v_line,p_org,v_return,'goods_receipt_line',grl.id,pol.item_id,p_location_id,p_quantity,'supplier_return',v_bucket,v_cost);
 INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
 VALUES(p_org,pol.item_id,p_location_id,v_bucket,'supplier_return',-p_quantity,v_cost,'MGA','supplier_return',v_return,v_line,'supplier-return:'||v_line::text,now(),auth.uid());
 PERFORM public.audit_event(p_org,'stock.supplier_return_posted','stock_return',v_return,NULL,jsonb_build_object('receipt_line_id',grl.id,'quantity',p_quantity,'bucket',v_bucket));
 RETURN v_return;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_stock_adjustment(
 p_org uuid,p_item_id uuid,p_location_id uuid,p_stock_bucket text,p_quantity_delta numeric,
 p_unit_cost numeric,p_reason text,p_evidence_reference text,p_request_key uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_on_hand numeric;v_value numeric;v_reserved numeric;v_cost numeric;v_adjustment uuid;v_line uuid;v_number text;v_existing public.stock_adjustments%rowtype;
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.manage');
 IF p_quantity_delta=0 OR p_stock_bucket NOT IN ('resale','company_use','consumption','quarantine') OR p_reason IS NULL OR length(trim(p_reason))<3 THEN
  RAISE EXCEPTION 'Paramètres de correction de stock invalides';
 END IF;
 SELECT * INTO v_existing FROM public.stock_adjustments WHERE organization_id=p_org AND request_key=p_request_key;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.stock_adjustment_lines WHERE adjustment_id=v_existing.id AND organization_id=p_org
   AND item_id=p_item_id AND stock_location_id=p_location_id AND stock_bucket=p_stock_bucket AND quantity_delta=p_quantity_delta) THEN
   RAISE EXCEPTION 'Clé de correction réutilisée avec des paramètres différents';
  END IF;
  RETURN v_existing.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalog_items WHERE id=p_item_id AND organization_id=p_org AND tracking_mode='quantity') THEN
  RAISE EXCEPTION 'Article non suivi en quantité';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_location_id AND organization_id=p_org AND is_active) THEN RAISE EXCEPTION 'Emplacement invalide'; END IF;
 SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(quantity_delta*unit_cost),0)
 INTO v_on_hand,v_value FROM public.stock_movements
 WHERE organization_id=p_org AND item_id=p_item_id AND stock_location_id=p_location_id AND stock_bucket=p_stock_bucket;
 IF p_quantity_delta<0 THEN
  SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
  FROM public.stock_reservations WHERE organization_id=p_org AND item_id=p_item_id AND stock_location_id=p_location_id
   AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
  IF v_on_hand-v_reserved+0.00000001<abs(p_quantity_delta) THEN RAISE EXCEPTION 'La correction ferait passer le stock disponible sous zéro'; END IF;
  v_cost:=CASE WHEN v_on_hand>0 THEN round(v_value/v_on_hand,2) ELSE 0 END;
 ELSE
  v_cost:=COALESCE(NULLIF(p_unit_cost,0),CASE WHEN v_on_hand>0 THEN round(v_value/v_on_hand,2) ELSE NULL END);
  IF v_cost IS NULL OR v_cost<0 THEN RAISE EXCEPTION 'Un coût unitaire justifié est obligatoire pour une entrée de correction sans coût moyen existant'; END IF;
 END IF;
 v_adjustment:=gen_random_uuid();v_line:=gen_random_uuid();
 v_number:='ADJ-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_adjustment::text,'-',''),1,8));
 INSERT INTO public.stock_adjustments(id,organization_id,adjustment_number,request_key,reason,evidence_reference,created_by)
 VALUES(v_adjustment,p_org,v_number,p_request_key,trim(p_reason),NULLIF(trim(COALESCE(p_evidence_reference,'')),''),auth.uid());
 INSERT INTO public.stock_adjustment_lines(id,organization_id,adjustment_id,item_id,stock_location_id,stock_bucket,quantity_delta,unit_cost)
 VALUES(v_line,p_org,v_adjustment,p_item_id,p_location_id,p_stock_bucket,p_quantity_delta,v_cost);
 INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
 VALUES(p_org,p_item_id,p_location_id,p_stock_bucket,CASE WHEN p_quantity_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
  p_quantity_delta,v_cost,'MGA','stock_adjustment',v_adjustment,v_line,'stock-adjustment:'||v_line::text,now(),auth.uid());
 UPDATE public.stock_adjustment_lines SET movement_id=(SELECT id FROM public.stock_movements WHERE organization_id=p_org AND event_key='stock-adjustment:'||v_line::text)
 WHERE id=v_line AND organization_id=p_org;
 PERFORM public.audit_event(p_org,'stock.adjustment_posted','stock_adjustment',v_adjustment,NULL,jsonb_build_object('item_id',p_item_id,'location_id',p_location_id,'bucket',p_stock_bucket,'quantity_delta',p_quantity_delta,'unit_cost',v_cost));
 RETURN v_adjustment;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_org uuid,p_transfer_id uuid,p_request_key uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE t public.stock_transfers%rowtype;l public.stock_transfer_lines%rowtype;v_on_hand numeric;v_reserved numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.manage');
 IF p_request_key IS NULL OR p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Clé de demande et motif d’annulation obligatoires'; END IF;
 SELECT * INTO t FROM public.stock_transfers WHERE id=p_transfer_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Transfert introuvable'; END IF;
 IF t.status='cancelled' THEN
  IF t.cancellation_request_key=p_request_key THEN RETURN; END IF;
  RAISE EXCEPTION 'Transfert déjà annulé avec une autre demande';
 END IF;
 FOR l IN SELECT * FROM public.stock_transfer_lines WHERE transfer_id=t.id AND organization_id=p_org FOR UPDATE LOOP
  SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements
   WHERE organization_id=p_org AND item_id=l.item_id AND stock_location_id=t.destination_location_id AND stock_bucket=l.stock_bucket;
  SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
   FROM public.stock_reservations WHERE organization_id=p_org AND item_id=l.item_id AND stock_location_id=t.destination_location_id
    AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
  IF v_on_hand-v_reserved+0.00000001<l.quantity THEN RAISE EXCEPTION 'Le stock transféré n’est plus disponible à l’emplacement de destination'; END IF;
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_org,l.item_id,t.destination_location_id,l.stock_bucket,'transfer_out',-l.quantity,l.unit_cost,'MGA','stock_transfer_cancel',t.id,l.id,'stock-transfer-cancel-out:'||l.id::text,now(),auth.uid()),
        (p_org,l.item_id,t.source_location_id,l.stock_bucket,'transfer_in',l.quantity,l.unit_cost,'MGA','stock_transfer_cancel',t.id,l.id,'stock-transfer-cancel-in:'||l.id::text,now(),auth.uid());
 END LOOP;
 UPDATE public.stock_transfers SET status='cancelled',cancellation_request_key=p_request_key,cancellation_reason=trim(p_reason),cancelled_at=now()
 WHERE id=t.id AND organization_id=p_org;
 PERFORM public.audit_event(p_org,'stock.transfer_cancelled','stock_transfer',t.id,jsonb_build_object('status','posted'),jsonb_build_object('status','cancelled','reason',trim(p_reason)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_sales_delivery(p_org uuid,p_delivery_id uuid,p_request_key uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE d public.sales_deliveries%rowtype;l public.sales_delivery_lines%rowtype;
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.manage');
 IF p_request_key IS NULL OR p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Clé de demande et motif d’annulation obligatoires'; END IF;
 SELECT * INTO d FROM public.sales_deliveries WHERE id=p_delivery_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Livraison introuvable'; END IF;
 IF d.status='cancelled' THEN
  IF d.cancellation_request_key=p_request_key THEN RETURN; END IF;
  RAISE EXCEPTION 'Livraison déjà annulée avec une autre demande';
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.sales_delivery_lines dl
  JOIN public.invoice_lines il ON il.source_order_line_id=dl.order_line_id AND il.organization_id=dl.organization_id
  JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
  WHERE dl.delivery_id=d.id AND dl.organization_id=p_org AND inv.status<>'cancelled'
 ) THEN RAISE EXCEPTION 'Une quantité de cette livraison est déjà facturée ou réservée dans un brouillon de facture. Utilise le workflow de retour et avoir.'; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_return_lines WHERE organization_id=p_org AND source_line_type='sales_delivery_line'
   AND source_line_id IN (SELECT id FROM public.sales_delivery_lines WHERE delivery_id=d.id AND organization_id=p_org)) THEN
  RAISE EXCEPTION 'Une livraison avec retour enregistré ne peut pas être annulée intégralement';
 END IF;
 FOR l IN SELECT * FROM public.sales_delivery_lines WHERE delivery_id=d.id AND organization_id=p_org FOR UPDATE LOOP
  INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
  VALUES(p_org,l.item_id,l.stock_location_id,'resale','adjustment_in',l.quantity_delivered,l.unit_cost,'MGA','delivery_cancel',d.id,l.id,'delivery-cancel:'||l.id::text,now(),auth.uid());
  UPDATE public.order_lines SET delivered_quantity=GREATEST(0,delivered_quantity-l.quantity_delivered)
   WHERE id=l.order_line_id AND organization_id=p_org;
  IF l.reservation_id IS NOT NULL THEN
   UPDATE public.stock_reservations SET quantity_fulfilled=GREATEST(0,quantity_fulfilled-l.quantity_delivered),
    status=CASE WHEN GREATEST(0,quantity_fulfilled-l.quantity_delivered)+quantity_released>=quantity_reserved THEN 'released' ELSE 'active' END
   WHERE id=l.reservation_id AND organization_id=p_org;
  END IF;
 END LOOP;
 UPDATE public.sales_deliveries SET status='cancelled',cancellation_request_key=p_request_key,cancellation_reason=trim(p_reason),cancelled_at=now()
 WHERE id=d.id AND organization_id=p_org;
 PERFORM public.audit_event(p_org,'sales.delivery_cancelled','sales_delivery',d.id,jsonb_build_object('status','posted'),jsonb_build_object('status','cancelled','reason',trim(p_reason)));
END;
$function$;

-- Permission checks are safe to expose as void-returning predicates: they
-- validate auth.uid() and never return organization data. Invoker RPCs such as
-- stock_balance_as_of must be able to call the shared permission guard.
REVOKE ALL ON FUNCTION public.assert_org_permission(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assert_org_permission(uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.stock_balance_as_of(p_org uuid,p_as_of timestamptz)
RETURNS TABLE(item_id uuid,stock_location_id uuid,stock_bucket text,quantity_on_hand numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
BEGIN
 PERFORM public.assert_org_access(p_org);PERFORM public.assert_org_permission(p_org,'inventory.view');
 IF p_as_of IS NULL THEN RAISE EXCEPTION 'Date de référence obligatoire'; END IF;
 RETURN QUERY
 SELECT m.item_id,m.stock_location_id,m.stock_bucket,SUM(m.quantity_delta)::numeric
 FROM public.stock_movements m
 WHERE m.organization_id=p_org AND m.effective_at<=p_as_of
 GROUP BY m.item_id,m.stock_location_id,m.stock_bucket;
END;
$function$;

CREATE OR REPLACE FUNCTION private.unbilled_customer_return_quantity(p_org uuid,p_order_line uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
 SELECT COALESCE(SUM(rl.quantity),0)::numeric
 FROM public.stock_return_lines rl
 JOIN public.stock_returns sr ON sr.id=rl.return_id AND sr.organization_id=rl.organization_id
 JOIN public.sales_delivery_lines dl ON dl.id=rl.source_line_id AND dl.organization_id=rl.organization_id
 WHERE rl.organization_id=p_org AND rl.source_line_type='sales_delivery_line'
  AND dl.order_line_id=p_order_line AND rl.source_invoice_line_id IS NULL
  AND sr.return_type='customer' AND sr.status='posted';
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(
 p_org uuid,p_customer uuid,p_due_date date,p_lines jsonb,p_order uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
 v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;ol public.order_lines%rowtype;
 v_order public.orders%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;
 v_description text;v_unit text;v_kind text;v_item uuid;v_order_line_id uuid;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;
 v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
 v_billed numeric;v_returned numeric;v_remaining numeric;v_seen_order_lines uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_due_date IS NULL OR p_due_date<current_date THEN RAISE EXCEPTION 'Échéance invalide'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>100 THEN
  RAISE EXCEPTION 'La facture doit contenir entre 1 et 100 lignes';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND is_active) THEN
  RAISE EXCEPTION 'Client invalide';
 END IF;
 IF p_order IS NOT NULL THEN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id<>p_customer OR v_order.status NOT IN ('confirmed','in_progress','completed') THEN
   RAISE EXCEPTION 'Commande ou client invalide';
  END IF;
 END IF;

 -- Validate all lines and remaining quantities before creating the invoice header.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=COALESCE((r->>'quantity')::numeric,0);
  d:=COALESCE((r->>'discount_pct')::numeric,0);
  v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF q<=0 OR d<0 OR d>100 THEN RAISE EXCEPTION 'Ligne de facture invalide'; END IF;

  IF v_kind='service' THEN
   IF NULLIF(r->>'service_id','') IS NULL THEN RAISE EXCEPTION 'Prestation manquante'; END IF;
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestation invalide'; END IF;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   IF unit_price<0 THEN RAISE EXCEPTION 'Prix unitaire invalide'; END IF;
   tax_rate:=s.tax_rate;v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF p_order IS NOT NULL THEN
    IF v_order_line_id IS NULL OR v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Chaque prestation d’une commande doit être rattachée une seule fois à sa ligne source'; END IF;
    SELECT * INTO ol FROM public.order_lines
     WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order AND service_id=s.id AND line_kind='service' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de prestation source invalide'; END IF;
    SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
     FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
     WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
    v_remaining:=ol.quantity-v_billed;
    IF q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse le reliquat de la prestation'; END IF;
    tax_rate:=ol.tax_rate;v_description:=ol.description;v_unit:=ol.unit;
    v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
   ELSIF v_order_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne source fournie sans commande';
   END IF;
  ELSIF v_kind='merchandise' THEN
   IF p_order IS NULL OR v_order_line_id IS NULL OR NULLIF(r->>'item_id','') IS NULL THEN
    RAISE EXCEPTION 'Une marchandise doit provenir d’une ligne de commande client';
   END IF;
   IF v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Une ligne de commande ne peut apparaître qu’une fois par facture'; END IF;
   SELECT * INTO ol FROM public.order_lines
    WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order
      AND item_id=(r->>'item_id')::uuid AND line_kind='merchandise' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de marchandise source invalide'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
   v_returned:=private.unbilled_customer_return_quantity(p_org,ol.id);
   v_remaining:=ol.delivered_quantity-v_billed-v_returned;
   IF v_remaining<=0 OR q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse les marchandises effectivement livrées et non encore facturées'; END IF;
   unit_price:=ol.unit_price;d:=ol.discount_pct;tax_rate:=ol.tax_rate;
   v_description:=ol.description;v_unit:=ol.unit;v_item:=ol.item_id;
   v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
  ELSE
   RAISE EXCEPTION 'Nature de ligne de facture non prise en charge';
  END IF;

  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 END LOOP;

 v_number:=public.next_document_number(p_org,'invoice');
 INSERT INTO public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
 VALUES(p_org,p_customer,p_order,v_number,'draft',current_date,p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid())
 RETURNING id INTO v_invoice;

 -- Rebuild the validated snapshot and persist the mixed invoice lines.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=(r->>'quantity')::numeric;v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF v_kind='service' THEN
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   d:=COALESCE((r->>'discount_pct')::numeric,0);tax_rate:=s.tax_rate;
   v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF v_order_line_id IS NOT NULL THEN
    SELECT source_line.tax_rate,source_line.description,source_line.unit INTO tax_rate,v_description,v_unit FROM public.order_lines source_line
    WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order AND source_line.service_id=s.id;
   END IF;
  ELSE
   SELECT source_line.unit_price,source_line.discount_pct,source_line.tax_rate,source_line.description,source_line.unit,source_line.item_id
    INTO unit_price,d,tax_rate,v_description,v_unit,v_item
   FROM public.order_lines source_line WHERE source_line.id=v_order_line_id AND source_line.organization_id=p_org AND source_line.order_id=p_order;
  END IF;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  INSERT INTO public.invoice_lines(organization_id,invoice_id,service_id,item_id,line_kind,source_order_line_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  VALUES(p_org,v_invoice,CASE WHEN v_kind='service' THEN s.id ELSE NULL END,v_item,v_kind,v_order_line_id,
    v_description,q,v_unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);
  v_sort:=v_sort+1;
 END LOOP;
 PERFORM public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,NULL,
  jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));
 RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_org uuid,p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE i public.invoices%rowtype; r record; v_lines jsonb; v_key text; v_account text; v_order_line public.order_lines%rowtype; v_billed numeric; v_returned numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.issue');
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 IF i.status<>'draft' THEN RAISE EXCEPTION 'Seule une facture brouillon peut être émise'; END IF;
 IF i.total<=0 THEN RAISE EXCEPTION 'Total invalide'; END IF;

 -- Revalidate delivery and remaining order quantities immediately before posting.
 FOR r IN SELECT * FROM public.invoice_lines WHERE organization_id=p_org AND invoice_id=i.id LOOP
  IF r.source_order_line_id IS NOT NULL THEN
   SELECT * INTO v_order_line FROM public.order_lines WHERE id=r.source_order_line_id AND organization_id=p_org FOR UPDATE;
   IF NOT FOUND OR v_order_line.order_id IS DISTINCT FROM i.order_id THEN RAISE EXCEPTION 'Ligne de commande source introuvable ou étrangère à la commande de la facture'; END IF;
   IF r.line_kind='service' AND v_order_line.service_id IS DISTINCT FROM r.service_id THEN RAISE EXCEPTION 'Prestation source incohérente'; END IF;
   IF r.line_kind='merchandise' AND v_order_line.item_id IS DISTINCT FROM r.item_id THEN RAISE EXCEPTION 'Marchandise source incohérente'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=r.source_order_line_id
      AND il.invoice_id<>i.id AND inv.status<>'cancelled';
   v_returned:=CASE WHEN r.line_kind='merchandise' THEN private.unbilled_customer_return_quantity(p_org,v_order_line.id) ELSE 0 END;
   IF r.line_kind='merchandise' AND r.quantity>v_order_line.delivered_quantity-v_billed-v_returned+0.00000001 THEN
    RAISE EXCEPTION 'Une marchandise de la facture n’est plus intégralement livrée ou disponible à facturer';
   ELSIF r.line_kind='service' AND r.quantity>v_order_line.quantity-v_billed+0.00000001 THEN
    RAISE EXCEPTION 'Une prestation de la facture dépasse le reliquat de commande';
   END IF;
  ELSIF r.line_kind='merchandise' THEN
   RAISE EXCEPTION 'Une marchandise doit rester rattachée à une commande client';
  END IF;
 END LOOP;

 v_lines:=jsonb_build_array(jsonb_build_object(
  'pcg_code',public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','customer_receivable','debit'),
  'debit',i.total,'credit',0,'customer_id',i.customer_id
 ));
 FOR r IN
  SELECT CASE
    WHEN line_kind='service' THEN 'service_revenue'
    WHEN line_kind='fee' THEN 'ancillary_revenue'
    WHEN item_id IS NOT NULL OR line_kind IN ('merchandise','equipment','consumable') THEN 'merchandise_revenue'
    ELSE 'ancillary_revenue'
   END AS operation_key,
   SUM(taxable_amount) AS amount
  FROM public.invoice_lines
  WHERE organization_id=p_org AND invoice_id=i.id
  GROUP BY 1
 LOOP
  IF r.amount>0 THEN
   v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition',r.operation_key,'credit');
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'pcg_code',v_account,'debit',0,'credit',r.amount,'customer_id',i.customer_id
   ));
  END IF;
 END LOOP;
 IF i.tax_total>0 THEN
  v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','tax_payable','credit');
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
   'pcg_code',v_account,'debit',0,'credit',i.tax_total,'customer_id',i.customer_id
  ));
 END IF;

 UPDATE public.invoices SET status='issued',issued_at=now(),balance_due=total-paid_amount,updated_at=now()
 WHERE id=i.id AND organization_id=p_org;
 PERFORM public.magnisa_post_journal(p_org,i.issue_date,i.number,'Émission facture '||i.number,'invoice',i.id,v_lines);
 PERFORM public.audit_event(p_org,'invoice.issued','invoice',i.id,jsonb_build_object('status','draft'),jsonb_build_object('status','issued'));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_customer_stock_return(uuid,uuid,uuid,numeric,text,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_supplier_stock_return(uuid,uuid,uuid,numeric,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid,uuid,uuid,text,numeric,numeric,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_stock_transfer(uuid,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_sales_delivery(uuid,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.stock_balance_as_of(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_customer_stock_return(uuid,uuid,uuid,numeric,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_supplier_stock_return(uuid,uuid,uuid,numeric,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid,uuid,uuid,text,numeric,numeric,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stock_transfer(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sales_delivery(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_balance_as_of(uuid,timestamptz) TO authenticated;

-- END CONSOLIDATED SOURCE: 20261110170000_stock_returns_adjustments_and_compensations.sql
