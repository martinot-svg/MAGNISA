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
 FOREACH t IN ARRAY ARRAY['stock_reservations','sales_deliveries','sales_delivery_lines','stock_transfers','stock_transfer_lines'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon',t);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.is_org_member(organization_id))',t||'_org_select',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

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
 IF NOT FOUND OR v_line.item_id IS DISTINCT FROM p_item_id OR v_line.line_kind NOT IN ('merchandise','equipment','consumable') THEN
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
 IF v_line_reserved+p_quantity>v_line.quantity+0.00000001 THEN RAISE EXCEPTION 'Reservation exceeds the remaining ordered quantity.'; END IF;
 IF v_on_hand-v_reserved<p_quantity THEN RAISE EXCEPTION 'Insufficient available stock. Available: %',v_on_hand-v_reserved; END IF;
 INSERT INTO public.stock_reservations(organization_id,order_id,order_line_id,item_id,stock_location_id,quantity_reserved,request_key,created_by)
 VALUES(p_organization_id,p_order_id,p_order_line_id,p_item_id,p_stock_location_id,p_quantity,p_request_key,auth.uid())
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.release_stock_reservation(p_organization_id uuid,p_reservation_id uuid,p_quantity numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $$
DECLARE r public.stock_reservations%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'Access denied.'; END IF;
 PERFORM public.assert_org_access(p_organization_id);
 PERFORM public.assert_org_permission(p_organization_id,'orders.manage');
 SELECT * INTO r FROM public.stock_reservations WHERE id=p_reservation_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('active','partially_fulfilled') THEN RAISE EXCEPTION 'Active reservation not found.'; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>r.quantity_reserved-r.quantity_fulfilled-r.quantity_released THEN RAISE EXCEPTION 'Invalid release quantity.'; END IF;
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
 v_on_hand numeric; v_reserved numeric; v_already numeric; v_remaining numeric; v_number text; v_fingerprint text; v_currency text;
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
CREATE OR REPLACE FUNCTION public.release_stock_reservation(p_organization_id uuid,p_reservation_id uuid,p_quantity numeric)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.release_stock_reservation($1,$2,$3); $$;
CREATE OR REPLACE FUNCTION public.post_sales_delivery(
 p_organization_id uuid,p_order_id uuid,p_lines jsonb,p_request_key uuid,p_delivery_reference text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.post_sales_delivery($1,$2,$3,$4,$5); $$;
CREATE OR REPLACE FUNCTION public.post_stock_transfer(
 p_organization_id uuid,p_source_location uuid,p_destination_location uuid,p_lines jsonb,p_request_key uuid,p_reason text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private
AS $$ SELECT private.post_stock_transfer($1,$2,$3,$4,$5,$6); $$;

REVOKE ALL ON FUNCTION private.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.release_stock_reservation(uuid,uuid,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.post_sales_delivery(uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION private.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.release_stock_reservation(uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_sales_delivery(uuid,uuid,jsonb,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.release_stock_reservation(uuid,uuid,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_sales_delivery(uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_stock(uuid,uuid,uuid,uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_stock_reservation(uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_sales_delivery(uuid,uuid,jsonb,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) TO authenticated;
