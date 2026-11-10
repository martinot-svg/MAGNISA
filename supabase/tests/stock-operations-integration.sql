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
 (:'order_c'::uuid,:'org_id'::uuid,:'customer_id'::uuid,'CI-STOCK-ORDER-C','confirmed',0,0,0,:'user_id'::uuid);
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
 v_line_a uuid;v_line_b uuid;v_line_c uuid;v_res uuid;v_del1 uuid;v_del2 uuid;v_transfer uuid;
 v_before numeric;v_after numeric;v_count integer;
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
 IF (SELECT COUNT(*) FROM public.journal_entries je JOIN public.stock_movements sm
     ON sm.id=je.source_id AND sm.organization_id=je.organization_id
     WHERE je.organization_id=v_org AND je.source_type='stock_issue' AND sm.source_type='sales_delivery')<>2 THEN
  RAISE EXCEPTION 'Each physical sales issue must have exactly one linked stock accounting journal';
 END IF;
 IF (SELECT COALESCE(SUM(jl.debit),0) FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
     WHERE je.organization_id=v_org AND je.source_type='stock_issue' AND jl.account_key='PCG:603')<>250
 OR (SELECT COALESCE(SUM(jl.credit),0) FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
     WHERE je.organization_id=v_org AND je.source_type='stock_issue' AND jl.account_key='PCG:37')<>250 THEN
  RAISE EXCEPTION 'Moving-average cost of goods sold was not posted to PCG 603 / 37';
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

 -- Tenant isolation: authenticated user has no membership in the other organization.
 SELECT count(*) INTO v_count FROM public.stock_movements WHERE organization_id='e2000000-0000-4000-8000-000000000001';
 IF v_count<>0 THEN RAISE EXCEPTION 'Stock ledger leaked rows across organizations'; END IF;
END $$;

ROLLBACK;
