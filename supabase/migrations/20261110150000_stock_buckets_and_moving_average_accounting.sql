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

CREATE OR REPLACE FUNCTION private.post_stock_movement_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private
AS $$
DECLARE v_amount numeric; v_lines jsonb; v_debit text; v_credit text; v_operation text;
BEGIN
 IF NEW.stock_bucket<>'resale' THEN RETURN NEW; END IF;
 IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
  v_operation:='stock_receipt'; v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
 ELSIF NEW.source_type='sales_delivery' AND NEW.movement_kind='issue' THEN
  v_operation:='stock_issue'; v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
 ELSE
  RETURN NEW;
 END IF;
 IF v_amount<=0 THEN RETURN NEW; END IF;
 IF v_operation='stock_receipt' THEN
  v_debit:=public.magnisa_resolve_pcg_account(NEW.organization_id,v_operation,'recognition','merchandise_stock','debit');
  v_credit:=public.magnisa_resolve_pcg_account(NEW.organization_id,v_operation,'recognition','stock_variation','credit');
 ELSE
  v_debit:=public.magnisa_resolve_pcg_account(NEW.organization_id,v_operation,'recognition','stock_variation','debit');
  v_credit:=public.magnisa_resolve_pcg_account(NEW.organization_id,v_operation,'recognition','merchandise_stock','credit');
 END IF;
 v_lines:=jsonb_build_array(
  jsonb_build_object('pcg_code',v_debit,'debit',v_amount,'credit',0),
  jsonb_build_object('pcg_code',v_credit,'debit',0,'credit',v_amount)
 );
 PERFORM public.magnisa_post_journal(
  NEW.organization_id,NEW.effective_at::date,
  'STK-'||upper(substr(replace(NEW.id::text,'-',''),1,12)),
  CASE WHEN v_operation='stock_receipt' THEN 'Entrée en stock de marchandises' ELSE 'Sortie de stock liée à une livraison client' END,
  v_operation,NEW.id,v_lines
 );
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
  IF NOT FOUND OR v_order_line.item_id IS DISTINCT FROM v_item OR v_order_line.line_kind NOT IN ('merchandise','equipment','consumable') THEN RAISE EXCEPTION 'Invalid stock order line.'; END IF;
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
