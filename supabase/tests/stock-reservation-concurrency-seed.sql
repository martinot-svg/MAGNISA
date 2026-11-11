-- Persistent fixtures for a real two-request/two-transaction stock reservation race.
-- Runs only in the disposable local Supabase CI database.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers(id,organization_id,name,is_active)
VALUES('e1000000-0000-4000-8000-000000000131','e1000000-0000-4000-8000-000000000001','Concurrent reservation CI customer',true);
INSERT INTO public.catalog_items(id,organization_id,sku,name,item_kind,base_unit,tracking_mode,default_sale_price)
VALUES('e1000000-0000-4000-8000-000000000132','e1000000-0000-4000-8000-000000000001','CI-CONCURRENT-01','Concurrent reservation router','merchandise','unit','quantity',100);
INSERT INTO public.stock_locations(id,organization_id,code,name,location_kind)
VALUES('e1000000-0000-4000-8000-000000000133','e1000000-0000-4000-8000-000000000001','CI-RACE','Concurrent reservation warehouse','warehouse');
INSERT INTO public.orders(id,organization_id,customer_id,number,status,subtotal,tax_total,total,created_by)
VALUES
 ('e1000000-0000-4000-8000-000000000134','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000131','CI-RACE-ORDER-A','confirmed',0,0,0,:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000135','e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000131','CI-RACE-ORDER-B','confirmed',0,0,0,:'user_id'::uuid);
INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,event_key,created_by)
VALUES('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000132','e1000000-0000-4000-8000-000000000133','resale','receipt',5,100,'MGA','ci_concurrency_seed','e1000000-0000-4000-8000-000000000132','ci-concurrency-seed:stock-132',:'user_id'::uuid);
SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',:'user_id'::uuid,'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
SELECT public.add_catalog_item_to_order('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000134','e1000000-0000-4000-8000-000000000132',4,100,0,0);
SELECT public.add_catalog_item_to_order('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000135','e1000000-0000-4000-8000-000000000132',4,100,0,0);
COMMIT;
