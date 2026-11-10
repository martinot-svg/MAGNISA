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
