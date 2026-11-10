-- Authenticated end-to-end tests for item orders, reservations, deliveries and transfers.
-- Uses the disposable local Supabase database and rolls back all fixture data.
\set ON_ERROR_STOP on
\set org_id 'e1000000-0000-4000-8000-000000000001'
\set item_id 'e1000000-0000-4000-8000-000000000031'
\set location_a 'e1000000-0000-4000-8000-000000000032'
\set location_b 'e1000000-0000-4000-8000-000000000033'
\set order_a 'e1000000-0000-4000-8000-000000000034'
\set order_b 'e1000000-0000-4000-8000-000000000035'
\set order_c 'e1000000-0000-4000-8000-000000000036'
\set customer_id 'e1000000-0000-4000-8000-000000000037'
\set request_a 'e1000000-0000-4000-8000-000000000038'
\set request_b 'e1000000-0000-4000-8000-000000000039'
\set request_c 'e1000000-0000-4000-8000-000000000040'
\set delivery_a 'e1000000-0000-4000-8000-000000000041'
\set delivery_b 'e1000000-0000-4000-8000-000000000042'
\set transfer_a 'e1000000-0000-4000-8000-000000000043'
\set reservation_a 'e1000000-0000-4000-8000-000000000044'
\set reservation_b 'e1000000-0000-4000-8000-000000000045'
\set other_org 'e2000000-0000-4000-8000-000000000001'
\set other_item 'e2000000-0000-4000-8000-000000000002'
\set other_location 'e2000000-0000-4000-8000-000000000003'
\set service_id 'e1000000-0000-4000-8000-000000000048'
\set service_line_id 'e1000000-0000-4000-8000-000000000049'
\set supplier_id 'e1000000-0000-4000-8000-000000000052'
\set purchase_order_id 'e1000000-0000-4000-8000-000000000053'
\set purchase_order_line_id 'e1000000-0000-4000-8000-000000000054'
\set goods_receipt_id 'e1000000-0000-4000-8000-000000000055'
\set goods_receipt_line_id 'e1000000-0000-4000-8000-000000000056'
\set order_d 'e1000000-0000-4000-8000-000000000057'
\set order_e 'e1000000-0000-4000-8000-000000000058'

BEGIN;
INSERT INTO public.customers(id,organization_id,name,is_active)
VALUES(:'customer_id'::uuid,:'org_id'::uuid,'Stock workflow CI customer',true);
INSERT INTO public.catalog_items(id,organization_id,sku,name,item_kind,base_unit,tracking_mode,default_sale_price)
VALUES(:'item_id'::uuid,:'org_id'::uuid,'CI-STOCK-01','CI tracked router','merchandise','unit','quantity',100);
INSERT INTO public.stock_locations(id,organization_id,code,name,location_kind)
VALUES
 (:'location_a'::uuid,:'org_id'::uuid,'CI-A','CI warehouse A','warehouse'),
 (:'location_b'::uuid,:'org_id'::uuid,'CI-B','CI warehouse B','warehouse');
INSERT INTO public.orders(id,organization_id,customer_id,number,status,subtotal,tax_total,total,created_by)
VALUES
 (:'order_a'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-A','confirmed',0,0,0,:'user_id'::uuid),
 (:'order_b'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-B','confirmed',0,0,0,:'user_id'::uuid),
 (:'order_c'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-C','confirmed',0,0,0,:'user_id'::uuid),
 (:'order_d'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-D','confirmed',0,0,0,:'user_id'::uuid),
 (:'order_e'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-E','confirmed',0,0,0,:'user_id'::uuid);
INSERT INTO public.services(id,organization_id,name,unit,unit_price,tax_rate,direct_cost_estimate,is_active,service_type)
VALUES(:'service_id'::uuid,:'org_id'::uuid,'CI installation service','intervention',1000,20,0,true,'one_off');
INSERT INTO public.order_lines(id,organization_id,order_id,service_id,line_kind,description,quantity,unit,unit_price,tax_rate,discount_pct,discount_amount,taxable_amount,line_total,sort_order)
VALUES(:'service_line_id'::uuid,:'org_id'::uuid,:'order_a'::uuid,:'service_id'::uuid,'service','Installation routeur',1,'intervention',1000,20,0,0,1000,1200,0);
INSERT INTO public.suppliers(id,organization_id,name,supplier_type,is_active)
VALUES(:'supplier_id'::uuid,:'org_id'::uuid,'CI router supplier','supplier',true);
INSERT INTO public.purchase_orders(id,organization_id,supplier_id,number,status,order_date,currency,subtotal,tax_total,total,created_by)
VALUES(:'purchase_order_id'::uuid,:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-RET-01','submitted',current_date,'MGA',50,0,50,:'user_id'::uuid);
INSERT INTO public.purchase_order_lines(id,organization_id,purchase_order_id,item_id,description,purchase_purpose,quantity_ordered,unit,unit_price,tax_rate,line_total,sort_order)
VALUES(:'purchase_order_line_id'::uuid,:'org_id'::uuid,:'purchase_order_id'::uuid,:'item_id'::uuid,'CI supplier return stock','resale',1,'unit',50,0,50,0);
INSERT INTO public.goods_receipts(id,organization_id,purchase_order_id,receipt_number,status,received_at,created_by)
VALUES(:'goods_receipt_id'::uuid,:'org_id'::uuid,:'purchase_order_id'::uuid,'CI-GR-RET-01','draft',now(),:'user_id'::uuid);
INSERT INTO public.goods_receipt_lines(id,organization_id,goods_receipt_id,purchase_order_line_id,stock_location_id,quantity_received,unit_cost)
VALUES(:'goods_receipt_line_id'::uuid,:'org_id'::uuid,:'goods_receipt_id'::uuid,:'purchase_order_line_id'::uuid,:'location_a'::uuid,1,50);
-- Seed physical stock through a single documented opening receipt event.
INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,event_key,created_by)
VALUES(:'org_id'::uuid,:'item_id'::uuid,:'location_a'::uuid,'receipt',10,50,'MGA','ci_opening_stock',:'item_id'::uuid,'ci-opening-stock:'||:'item_id',:'user_id'::uuid);
INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,event_key,created_by)
VALUES(:'org_id'::uuid,:'item_id'::uuid,:'location_a'::uuid,'company_use','receipt',4,80,'MGA','ci_company_use_stock',:'item_id'::uuid,'ci-company-use:'||:'item_id',:'user_id'::uuid);
INSERT INTO public.organizations(id,name) VALUES(:'other_org'::uuid,'Stock workflow isolated tenant');
INSERT INTO public.catalog_items(id,organization_id,sku,name,item_kind,base_unit,tracking_mode)
VALUES(:'other_item'::uuid,:'other_org'::uuid,'CI-OTHER-01','Other tenant item','merchandise','unit','quantity');
INSERT INTO public.stock_locations(id,organization_id,code,name)
VALUES(:'other_location'::uuid,:'other_org'::uuid,'CI-OTHER','Other tenant location');
INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,event_key,created_by)
VALUES(:'other_org'::uuid,:'other_item'::uuid,:'other_location'::uuid,'receipt',7,20,'MGA','ci_other_tenant',:'other_item'::uuid,'ci-other-tenant:'||:'other_item',:'user_id'::uuid);

SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',:'user_id'::uuid,'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
 v_org uuid:='e1000000-0000-4000-8000-000000000001';
 v_item uuid:='e1000000-0000-4000-8000-000000000031';
 v_loc_a uuid:='e1000000-0000-4000-8000-000000000032';
 v_loc_b uuid:='e1000000-0000-4000-8000-000000000033';
 v_order_a uuid:='e1000000-0000-4000-8000-000000000034';
 v_order_b uuid:='e1000000-0000-4000-8000-000000000035';
 v_order_c uuid:='e1000000-0000-4000-8000-000000000036';
 v_order_d uuid:='e1000000-0000-4000-8000-000000000057';v_order_e uuid:='e1000000-0000-4000-8000-000000000058';
 v_receipt uuid:='e1000000-0000-4000-8000-000000000055';v_receipt_line uuid:='e1000000-0000-4000-8000-000000000056';
 v_line_a uuid;v_line_b uuid;v_line_c uuid;v_res uuid;v_del1 uuid;v_del2 uuid;v_transfer uuid;v_invoice_a uuid;v_invoice_b uuid;
 v_before numeric;v_after numeric;v_count integer;v_line_d uuid;v_line_e uuid;v_res_d uuid;v_res_e uuid;v_del_d uuid;v_del_e uuid;v_return uuid;v_supplier_return uuid;v_adjustment uuid;v_asof numeric;
 v_delivery jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Authenticated tenant fixture is not active'; END IF;
 v_line_a:=public.add_catalog_item_to_order(v_org,v_order_a,v_item,5,100,20,0);
 v_line_b:=public.add_catalog_item_to_order(v_org,v_order_b,v_item,3,100,20,0);
 v_line_c:=public.add_catalog_item_to_order(v_org,v_order_c,v_item,2,100,20,0);
 IF NOT EXISTS(SELECT 1 FROM public.order_lines WHERE id=v_line_a AND line_kind='merchandise' AND item_id=v_item) THEN RAISE EXCEPTION 'Mixed item order line was not created'; END IF;

 SELECT SUM(quantity_delta) INTO v_before FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale';
 v_res:=public.reserve_stock(v_org,v_order_a,v_line_a,v_item,v_loc_a,5,'e1000000-0000-4000-8000-000000000044');
 SELECT SUM(quantity_delta) INTO v_after FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale';
 IF v_before<>v_after THEN RAISE EXCEPTION 'Reservation changed physical stock'; END IF;
 IF (SELECT quantity_available FROM public.stock_available WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale')<>5 THEN
  RAISE EXCEPTION 'Available stock must equal physical less reserved after reservation';
 END IF;
 BEGIN
  PERFORM public.reserve_stock(v_org,v_order_b,v_line_b,v_item,v_loc_a,6,'e1000000-0000-4000-8000-000000000045');
  RAISE EXCEPTION 'Over-reservation should have failed';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Over-reservation should have failed' THEN RAISE; END IF;
 END;

 v_delivery:=jsonb_build_array(jsonb_build_object('order_line_id',v_line_a,'item_id',v_item,'stock_location_id',v_loc_a,'quantity',2,'unit_cost',50,'reservation_id',v_res));
 v_del1:=public.post_sales_delivery(v_org,v_order_a,v_delivery,'e1000000-0000-4000-8000-000000000041','CI-DL-1');
 IF public.post_sales_delivery(v_org,v_order_a,v_delivery,'e1000000-0000-4000-8000-000000000041','CI-DL-1')<>v_del1 THEN RAISE EXCEPTION 'Delivery retry is not idempotent'; END IF;
 v_delivery:=jsonb_build_array(jsonb_build_object('order_line_id',v_line_a,'item_id',v_item,'stock_location_id',v_loc_a,'quantity',3,'unit_cost',50,'reservation_id',v_res));
 v_del2:=public.post_sales_delivery(v_org,v_order_a,v_delivery,'e1000000-0000-4000-8000-000000000042','CI-DL-2');
 IF (SELECT delivered_quantity FROM public.order_lines WHERE id=v_line_a)<>5 THEN RAISE EXCEPTION 'Partial plus final delivery did not reconcile to ordered quantity'; END IF;
 IF (SELECT quantity_fulfilled FROM public.stock_reservations WHERE id=v_res)<>5 THEN RAISE EXCEPTION 'Reservation was not fulfilled by delivery'; END IF;
 SELECT SUM(quantity_delta) INTO v_after FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale';
 IF v_after<>5 THEN RAISE EXCEPTION 'Delivery did not issue exactly five resale units'; END IF;
 IF (SELECT quantity_available FROM public.stock_available WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='company_use')<>4 THEN
  RAISE EXCEPTION 'Company-use stock was not kept separate from resale availability';
 END IF;
 IF (SELECT COUNT(*) FROM public.accounting_event_outbox e
     JOIN public.stock_movements sm ON sm.id=e.source_id AND sm.organization_id=e.organization_id
     WHERE e.organization_id=v_org AND e.event_type='stock_issue' AND sm.source_type='sales_delivery')<>2 THEN
  RAISE EXCEPTION 'Each physical sales issue must create one durable accounting event';
 END IF;
 IF (SELECT COALESCE(SUM((payload->>'amount')::numeric),0) FROM public.accounting_event_outbox
     WHERE organization_id=v_org AND event_type='stock_issue')<>250 THEN
  RAISE EXCEPTION 'CUMP stock issue value was not captured in the accounting outbox';
 END IF;
 v_invoice_a:=public.create_invoice_draft(v_org,'e1000000-0000-4000-8000-000000000037',current_date+30,
  jsonb_build_array(
   jsonb_build_object('line_kind','service','service_id','e1000000-0000-4000-8000-000000000048','order_line_id','e1000000-0000-4000-8000-000000000049','quantity',1,'discount_pct',0,'unit_price',1000),
   jsonb_build_object('line_kind','merchandise','item_id',v_item,'order_line_id',v_line_a,'quantity',2,'discount_pct',0,'unit_price',100)
  ),v_order_a);
 v_invoice_b:=public.create_invoice_draft(v_org,'e1000000-0000-4000-8000-000000000037',current_date+30,
  jsonb_build_array(jsonb_build_object('line_kind','merchandise','item_id',v_item,'order_line_id',v_line_a,'quantity',3,'discount_pct',0,'unit_price',100)),v_order_a);
 IF (SELECT COUNT(*) FROM public.invoice_lines WHERE organization_id=v_org AND invoice_id=v_invoice_a AND line_kind='service' AND service_id='e1000000-0000-4000-8000-000000000048')<>1
 OR (SELECT COUNT(*) FROM public.invoice_lines WHERE organization_id=v_org AND invoice_id=v_invoice_a AND line_kind='merchandise' AND item_id=v_item AND source_order_line_id=v_line_a)<>1
 OR (SELECT COUNT(*) FROM public.invoice_lines WHERE organization_id=v_org AND invoice_id=v_invoice_b AND line_kind='merchandise' AND item_id=v_item AND source_order_line_id=v_line_a)<>1 THEN
  RAISE EXCEPTION 'Mixed invoice did not preserve service and merchandise line identities';
 END IF;
 BEGIN
  PERFORM public.create_invoice_draft(v_org,'e1000000-0000-4000-8000-000000000037',current_date+30,
   jsonb_build_array(jsonb_build_object('line_kind','merchandise','item_id',v_item,'order_line_id',v_line_a,'quantity',0.1,'discount_pct',0,'unit_price',100)),v_order_a);
  RAISE EXCEPTION 'Invoicing beyond delivered and unbilled quantity should fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Invoicing beyond delivered and unbilled quantity should fail' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE organization_id=v_org AND source_type='invoice' AND source_id IN (v_invoice_a,v_invoice_b)) THEN
  RAISE EXCEPTION 'Draft invoices must not be posted to accounting';
 END IF;
 BEGIN
  PERFORM public.post_customer_stock_return(v_org,(SELECT id FROM public.sales_delivery_lines WHERE delivery_id=v_del1 LIMIT 1),v_loc_a,0.1,'resalable','e1000000-0000-4000-8000-000000000077','CI return with draft invoice');
  RAISE EXCEPTION 'A delivery linked to a draft invoice must not be returned before the draft is cancelled';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='A delivery linked to a draft invoice must not be returned before the draft is cancelled' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.accounting_event_outbox WHERE organization_id=v_org AND event_type='stock_issue' AND status='posted')
 AND (SELECT COUNT(*) FROM public.journal_entries je JOIN public.stock_movements sm
     ON sm.id=je.source_id AND sm.organization_id=je.organization_id
     WHERE je.organization_id=v_org AND je.source_type='stock_movement' AND sm.source_type='sales_delivery')<>2 THEN
  RAISE EXCEPTION 'Posted stock accounting events must each have one linked journal';
 END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_event_outbox WHERE organization_id=v_org AND event_type='stock_issue' AND status='posted')
 AND ((SELECT COALESCE(SUM(jl.debit),0) FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
     WHERE je.organization_id=v_org AND je.source_type='stock_movement' AND jl.account_key='PCG:603')<>250
 OR (SELECT COALESCE(SUM(jl.credit),0) FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
     WHERE je.organization_id=v_org AND je.source_type='stock_movement' AND jl.account_key='PCG:37')<>250) THEN
  RAISE EXCEPTION 'Posted CUMP stock issue journals must balance PCG 603 / 37';
 END IF;

 v_transfer:=public.post_stock_transfer(v_org,v_loc_a,v_loc_b,
  jsonb_build_array(jsonb_build_object('item_id',v_item,'quantity',2,'unit_cost',50)),
  'e1000000-0000-4000-8000-000000000043','CI transfer test');
 IF public.post_stock_transfer(v_org,v_loc_a,v_loc_b,
  jsonb_build_array(jsonb_build_object('item_id',v_item,'quantity',2,'unit_cost',50)),
  'e1000000-0000-4000-8000-000000000043','CI transfer test')<>v_transfer THEN RAISE EXCEPTION 'Transfer retry is not idempotent'; END IF;
 SELECT SUM(quantity_delta) INTO v_after FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_bucket='resale';
 IF v_after<>5 THEN RAISE EXCEPTION 'Transfer changed total company stock'; END IF;
 IF (SELECT SUM(quantity_delta) FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_b AND stock_bucket='resale')<>2 THEN
  RAISE EXCEPTION 'Transfer destination did not receive the quantity';
 END IF;

 -- The second customer can reserve only the remaining available quantity.
 v_res:=public.reserve_stock(v_org,v_order_b,v_line_b,v_item,v_loc_a,3,'e1000000-0000-4000-8000-000000000045');
 IF (SELECT SUM(quantity_delta) FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale')<>3 THEN
  RAISE EXCEPTION 'Expected 3 physical resale units after transfer at source';
 END IF;
 IF (SELECT SUM(quantity_reserved-quantity_fulfilled-quantity_released) FROM public.stock_reservations WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale' AND status IN ('active','partially_fulfilled'))<>3 THEN
  RAISE EXCEPTION 'Expected 3 active resale units reserved at source';
 END IF;
 IF (SELECT quantity_available FROM public.stock_available WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale')<>0 THEN
  RAISE EXCEPTION 'Stock availability view must be zero after reservation';
 END IF;
 BEGIN
  PERFORM public.reserve_stock(v_org,v_order_c,v_line_c,v_item,v_loc_a,1,'e1000000-0000-4000-8000-000000000046');
  RAISE EXCEPTION 'Competing reservation should not oversubscribe stock';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Competing reservation should not oversubscribe stock' THEN RAISE; END IF;
 END;
 PERFORM public.release_stock_reservation(v_org,v_res,1,'e1000000-0000-4000-8000-000000000047');
 PERFORM public.release_stock_reservation(v_org,v_res,1,'e1000000-0000-4000-8000-000000000047');
 IF (SELECT quantity_released FROM public.stock_reservations WHERE id=v_res)<>1 THEN
  RAISE EXCEPTION 'Reservation release retry changed the quantity more than once';
 END IF;

 -- Compensate the posted transfer without editing its original movement history.
 PERFORM public.release_stock_reservation(v_org,v_res,2,'e1000000-0000-4000-8000-000000000060');
 PERFORM public.cancel_stock_transfer(v_org,v_transfer,'e1000000-0000-4000-8000-000000000061','CI cancellation of transfer');
 PERFORM public.cancel_stock_transfer(v_org,v_transfer,'e1000000-0000-4000-8000-000000000061','CI cancellation of transfer');
 IF (SELECT SUM(quantity_delta) FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale')<>5
 OR (SELECT SUM(quantity_delta) FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_b AND stock_bucket='resale')<>0 THEN
  RAISE EXCEPTION 'Transfer cancellation did not restore source and destination balances';
 END IF;

 -- A real supplier receipt is posted, then partially returned twice against the same source line.
 PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000055');
 v_supplier_return:=public.post_supplier_stock_return(v_org,'e1000000-0000-4000-8000-000000000056',v_loc_a,0.5,'e1000000-0000-4000-8000-000000000062','CI partial supplier return');
 IF public.post_supplier_stock_return(v_org,'e1000000-0000-4000-8000-000000000056',v_loc_a,0.5,'e1000000-0000-4000-8000-000000000062','CI partial supplier return')<>v_supplier_return THEN
  RAISE EXCEPTION 'Supplier return retry is not idempotent';
 END IF;
 PERFORM public.post_supplier_stock_return(v_org,'e1000000-0000-4000-8000-000000000056',v_loc_a,0.5,'e1000000-0000-4000-8000-000000000063','CI final supplier return');
 BEGIN
  PERFORM public.post_supplier_stock_return(v_org,'e1000000-0000-4000-8000-000000000056',v_loc_a,0.1,'e1000000-0000-4000-8000-000000000064','CI over return');
  RAISE EXCEPTION 'Supplier return beyond received quantity should fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Supplier return beyond received quantity should fail' THEN RAISE; END IF;
 END;

 -- Partial customer returns split resalable and quarantined goods without changing the original delivery.
 v_line_d:=public.add_catalog_item_to_order(v_org,v_order_d,v_item,1,100,20,0);
 v_res_d:=public.reserve_stock(v_org,v_order_d,v_line_d,v_item,v_loc_a,1,'e1000000-0000-4000-8000-000000000065');
 v_delivery:=jsonb_build_array(jsonb_build_object('order_line_id',v_line_d,'item_id',v_item,'stock_location_id',v_loc_a,'quantity',1,'reservation_id',v_res_d));
 v_del_d:=public.post_sales_delivery(v_org,v_order_d,v_delivery,'e1000000-0000-4000-8000-000000000066','CI-DL-D');
 v_return:=public.post_customer_stock_return(v_org,(SELECT id FROM public.sales_delivery_lines WHERE delivery_id=v_del_d LIMIT 1),v_loc_a,0.5,'damaged','e1000000-0000-4000-8000-000000000067','CI damaged partial customer return');
 IF public.post_customer_stock_return(v_org,(SELECT id FROM public.sales_delivery_lines WHERE delivery_id=v_del_d LIMIT 1),v_loc_a,0.5,'damaged','e1000000-0000-4000-8000-000000000067','CI damaged partial customer return')<>v_return THEN
  RAISE EXCEPTION 'Customer return retry is not idempotent';
 END IF;
 PERFORM public.post_customer_stock_return(v_org,(SELECT id FROM public.sales_delivery_lines WHERE delivery_id=v_del_d LIMIT 1),v_loc_a,0.5,'resalable','e1000000-0000-4000-8000-000000000068','CI resalable partial customer return');
 IF (SELECT quantity_on_hand FROM public.stock_available WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='quarantine')<>0.5
 OR (SELECT quantity_available FROM public.stock_available WHERE organization_id=v_org AND item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='quarantine')<>0 THEN
  RAISE EXCEPTION 'Damaged customer returns must be physically tracked but unavailable for sale';
 END IF;
 BEGIN
  PERFORM public.post_customer_stock_return(v_org,(SELECT id FROM public.sales_delivery_lines WHERE delivery_id=v_del_d LIMIT 1),v_loc_a,0.1,'resalable','e1000000-0000-4000-8000-000000000069','CI over return');
  RAISE EXCEPTION 'Customer return beyond delivered quantity should fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Customer return beyond delivered quantity should fail' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.create_invoice_draft(v_org,'e1000000-0000-4000-8000-000000000037',current_date+30,
   jsonb_build_array(jsonb_build_object('line_kind','merchandise','item_id',v_item,'order_line_id',v_line_d,'quantity',0.1,'discount_pct',0,'unit_price',100)),v_order_d);
  RAISE EXCEPTION 'Unbilled returned merchandise must not be invoiced';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Unbilled returned merchandise must not be invoiced' THEN RAISE; END IF;
 END;

 -- A not-yet-invoiced delivery can be cancelled only through compensating stock movements.
 v_line_e:=public.add_catalog_item_to_order(v_org,v_order_e,v_item,1,100,20,0);
 v_res_e:=public.reserve_stock(v_org,v_order_e,v_line_e,v_item,v_loc_a,1,'e1000000-0000-4000-8000-000000000070');
 v_delivery:=jsonb_build_array(jsonb_build_object('order_line_id',v_line_e,'item_id',v_item,'stock_location_id',v_loc_a,'quantity',1,'reservation_id',v_res_e));
 v_del_e:=public.post_sales_delivery(v_org,v_order_e,v_delivery,'e1000000-0000-4000-8000-000000000071','CI-DL-E');
 PERFORM public.cancel_sales_delivery(v_org,v_del_e,'e1000000-0000-4000-8000-000000000072','CI cancellation before invoice');
 PERFORM public.cancel_sales_delivery(v_org,v_del_e,'e1000000-0000-4000-8000-000000000072','CI cancellation before invoice');
 IF (SELECT delivered_quantity FROM public.order_lines WHERE id=v_line_e)<>0
 OR (SELECT quantity_fulfilled FROM public.stock_reservations WHERE id=v_res_e)<>0 THEN
  RAISE EXCEPTION 'Delivery cancellation did not reverse order and reservation quantities';
 END IF;
 PERFORM public.release_stock_reservation(v_org,v_res_e,1,'e1000000-0000-4000-8000-000000000073');

 -- Inventory corrections are signed, idempotent, CUMP-valued and preserved in the as-of ledger.
 v_adjustment:=public.post_stock_adjustment(v_org,v_item,v_loc_a,'resale',1,50,'CI positive count correction','CI-count-2026-01','e1000000-0000-4000-8000-000000000074');
 IF public.post_stock_adjustment(v_org,v_item,v_loc_a,'resale',1,50,'CI positive count correction','CI-count-2026-01','e1000000-0000-4000-8000-000000000074')<>v_adjustment THEN
  RAISE EXCEPTION 'Stock adjustment retry is not idempotent';
 END IF;
 PERFORM public.post_stock_adjustment(v_org,v_item,v_loc_a,'resale',-0.5,0,'CI negative count correction','CI-count-2026-02','e1000000-0000-4000-8000-000000000075');
 BEGIN
  PERFORM public.post_stock_adjustment(v_org,v_item,v_loc_a,'resale',-100,0,'CI invalid negative count','CI-count-invalid','e1000000-0000-4000-8000-000000000076');
  RAISE EXCEPTION 'Negative adjustment beyond available stock should fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Negative adjustment beyond available stock should fail' THEN RAISE; END IF;
 END;
 SELECT quantity_on_hand INTO v_asof FROM public.stock_balance_as_of(v_org,now()+interval '1 day')
 WHERE item_id=v_item AND stock_location_id=v_loc_a AND stock_bucket='resale';
 IF v_asof<>5 THEN RAISE EXCEPTION 'As-of stock balance does not match the persistent movement ledger'; END IF;
 IF (SELECT COUNT(*) FROM public.accounting_event_outbox WHERE organization_id=v_org AND event_type IN ('stock_return','stock_supplier_return','stock_adjustment_in','stock_adjustment_out'))<6 THEN
  RAISE EXCEPTION 'Return and adjustment accounting events were not durably recorded';
 END IF;

 -- Tenant isolation: authenticated user has no membership in the other organization.
 SELECT count(*) INTO v_count FROM public.stock_movements WHERE organization_id='e2000000-0000-4000-8000-000000000001';
 IF v_count<>0 THEN RAISE EXCEPTION 'Stock ledger leaked rows across organizations'; END IF;
END $$;

ROLLBACK;
