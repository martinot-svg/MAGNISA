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
VALUES(:'purchase_order_id'::uuid,:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-RET-01','draft',current_date,'MGA',50,0,50,:'user_id'::uuid);
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


-- Dedicated supplier partial-receipt and customer-mandate fixtures.
INSERT INTO public.catalog_items(id,organization_id,sku,name,item_kind,base_unit,tracking_mode)
VALUES
 ('e1000000-0000-4000-8000-000000000079',:'org_id'::uuid,'CI-PARTIAL-01','Partial receipt test router','merchandise','unit','quantity'),
 ('e1000000-0000-4000-8000-000000000086',:'org_id'::uuid,'CI-MANDATE-01','Customer mandate kit','equipment','unit','quantity'),
 ('e1000000-0000-4000-8000-000000000095',:'org_id'::uuid,'CI-MANDATE-BAD','Invalid mandate kit','equipment','unit','quantity');
INSERT INTO public.purchase_orders(id,organization_id,supplier_id,number,status,order_date,currency,subtotal,tax_total,total,created_by)
VALUES
 ('e1000000-0000-4000-8000-000000000080',:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-PARTIAL','draft',current_date,'MGA',100,0,100,:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000087',:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-MANDATE','draft',current_date,'MGA',500,0,500,:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000096',:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-MANDATE-BAD','draft',current_date,'MGA',500,0,500,:'user_id'::uuid);
INSERT INTO public.purchase_order_lines(id,organization_id,purchase_order_id,item_id,description,purchase_purpose,quantity_ordered,unit,unit_price,tax_rate,line_total,sort_order)
VALUES
 ('e1000000-0000-4000-8000-000000000081',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000080','e1000000-0000-4000-8000-000000000079','Two router units','resale',2,'unit',50,0,100,0);
INSERT INTO public.purchase_order_lines(id,organization_id,purchase_order_id,item_id,description,purchase_purpose,beneficiary_customer_id,mandate_confirmed,supplier_document_names_customer,company_bears_goods_risk,exact_cost_supported,mandate_supplier_document_reference,quantity_ordered,unit,unit_price,tax_rate,line_total,sort_order)
VALUES ('e1000000-0000-4000-8000-000000000088',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000087','e1000000-0000-4000-8000-000000000086','Customer kit under documented mandate','customer_mandate',:'customer_id'::uuid,true,true,false,true,'CI-SUPPLIER-INVOICE-CUSTOMER-001',1,'unit',500,0,500,0);
INSERT INTO public.purchase_order_lines(id,organization_id,purchase_order_id,item_id,description,purchase_purpose,beneficiary_customer_id,mandate_confirmed,supplier_document_names_customer,company_bears_goods_risk,exact_cost_supported,mandate_supplier_document_reference,quantity_ordered,unit,unit_price,tax_rate,line_total,sort_order)
VALUES ('e1000000-0000-4000-8000-000000000097',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000096','e1000000-0000-4000-8000-000000000095','Mandate without evidence','customer_mandate',:'customer_id'::uuid,false,false,true,false,NULL,1,'unit',500,0,500,0);

UPDATE public.purchase_orders SET status='submitted'
WHERE organization_id=:'org_id'::uuid
  AND id IN (:'purchase_order_id'::uuid,'e1000000-0000-4000-8000-000000000080','e1000000-0000-4000-8000-000000000087','e1000000-0000-4000-8000-000000000096');
INSERT INTO public.goods_receipts(id,organization_id,purchase_order_id,receipt_number,status,received_at,created_by)
VALUES
 ('e1000000-0000-4000-8000-000000000082',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000080','CI-GR-PARTIAL-1','draft',now(),:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000084',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000080','CI-GR-PARTIAL-2','draft',now(),:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000089',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000087','CI-GR-MANDATE','draft',now(),:'user_id'::uuid),
 ('e1000000-0000-4000-8000-000000000098',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000096','CI-GR-MANDATE-BAD','draft',now(),:'user_id'::uuid);
INSERT INTO public.goods_receipt_lines(id,organization_id,goods_receipt_id,purchase_order_line_id,stock_location_id,quantity_received,unit_cost)
VALUES
 ('e1000000-0000-4000-8000-000000000083',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000082','e1000000-0000-4000-8000-000000000081',:'location_a'::uuid,1,50),
 ('e1000000-0000-4000-8000-000000000085',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000084','e1000000-0000-4000-8000-000000000081',:'location_a'::uuid,1,50),
 ('e1000000-0000-4000-8000-000000000090',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000089','e1000000-0000-4000-8000-000000000088',NULL,1,500),
 ('e1000000-0000-4000-8000-000000000099',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000098','e1000000-0000-4000-8000-000000000097',NULL,1,500);
INSERT INTO public.purchase_orders(id,organization_id,supplier_id,number,status,order_date,currency,subtotal,tax_total,total,created_by)
VALUES('e1000000-0000-4000-8000-000000000100',:'org_id'::uuid,:'supplier_id'::uuid,'CI-PO-MULTI-2','submitted',current_date,'MGA',50,0,50,:'user_id'::uuid);
INSERT INTO public.purchase_order_lines(id,organization_id,purchase_order_id,item_id,description,purchase_purpose,quantity_ordered,unit,unit_price,tax_rate,line_total,sort_order)
VALUES('e1000000-0000-4000-8000-000000000101',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000100','e1000000-0000-4000-8000-000000000079','Second order router','resale',1,'unit',50,0,50,0);
INSERT INTO public.goods_receipts(id,organization_id,purchase_order_id,receipt_number,status,received_at,created_by)
VALUES('e1000000-0000-4000-8000-000000000102',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000100','CI-GR-MULTI-2','draft',now(),:'user_id'::uuid);
INSERT INTO public.goods_receipt_lines(id,organization_id,goods_receipt_id,purchase_order_line_id,stock_location_id,quantity_received,unit_cost)
VALUES('e1000000-0000-4000-8000-000000000103',:'org_id'::uuid,'e1000000-0000-4000-8000-000000000102','e1000000-0000-4000-8000-000000000101',:'location_a'::uuid,1,50);
INSERT INTO public.financial_accounts(id,organization_id,name,type,balance,is_active)
VALUES('e1000000-0000-4000-8000-000000000104',:'org_id'::uuid,'CI Mandate Bank','bank',10000,true)
ON CONFLICT (organization_id,name) DO NOTHING;

SELECT set_config('request.jwt.claim.sub', :'user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',:'user_id'::uuid,'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
 v_org uuid:='e1000000-0000-4000-8000-000000000001';
 v_item_partial uuid:='e1000000-0000-4000-8000-000000000079';
 v_item_mandate uuid:='e1000000-0000-4000-8000-000000000086';
 v_item_bad uuid:='e1000000-0000-4000-8000-000000000095';
 v_on_hand numeric;
BEGIN
 PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000082');
 IF (SELECT status FROM public.purchase_orders WHERE id='e1000000-0000-4000-8000-000000000080')<>'partially_received'
 OR (SELECT quantity_received FROM public.purchase_order_lines WHERE id='e1000000-0000-4000-8000-000000000081')<>1 THEN
  RAISE EXCEPTION 'First partial supplier receipt did not preserve the remaining quantity';
 END IF;
 PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000084');
 IF (SELECT status FROM public.purchase_orders WHERE id='e1000000-0000-4000-8000-000000000080')<>'received'
 OR (SELECT quantity_received FROM public.purchase_order_lines WHERE id='e1000000-0000-4000-8000-000000000081')<>2 THEN
  RAISE EXCEPTION 'Second supplier receipt did not close the purchase order';
 END IF;
 SELECT COALESCE(SUM(quantity_delta),0) INTO v_on_hand FROM public.stock_movements
 WHERE organization_id=v_org AND item_id=v_item_partial AND stock_bucket='resale';
 IF v_on_hand<>2 THEN RAISE EXCEPTION 'Two partial receipts must create exactly two physical stock units'; END IF;

 PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000089');
 IF EXISTS(SELECT 1 FROM public.stock_movements WHERE organization_id=v_org AND item_id=v_item_mandate) THEN
  RAISE EXCEPTION 'Customer-mandate goods must never enter company stock';
 END IF;
 IF (SELECT quantity_received FROM public.purchase_order_lines WHERE id='e1000000-0000-4000-8000-000000000088')<>1 THEN
  RAISE EXCEPTION 'Documented mandate receipt quantity was not recorded';
 END IF;

 BEGIN
  PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000098');
  RAISE EXCEPTION 'Mandate receipt without legal and supplier-document evidence must fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Mandate receipt without legal and supplier-document evidence must fail' THEN RAISE; END IF;
 END;
 IF (SELECT status FROM public.goods_receipts WHERE id='e1000000-0000-4000-8000-000000000098')<>'draft'
 OR (SELECT quantity_received FROM public.purchase_order_lines WHERE id='e1000000-0000-4000-8000-000000000097')<>0 THEN
  RAISE EXCEPTION 'Rejected mandate receipt must leave no partial write';
 END IF;

DO $
DECLARE
 v_org uuid:='e1000000-0000-4000-8000-000000000001';
 v_disbursement uuid;
 v_retry uuid;
 v_reimbursement uuid;
 v_reimbursement_retry uuid;
 v_disbursement_second uuid;
 v_invoice uuid;
 v_matches integer;
 v_balance numeric;
 v_match_status text;
 v_orders text;
BEGIN
 PERFORM public.post_goods_receipt('e1000000-0000-4000-8000-000000000102');

 -- Company-paid mandate is a customer receivable, not stock or supplier expense.
 v_disbursement:=public.record_customer_mandate_disbursement(
   v_org,'e1000000-0000-4000-8000-000000000088','CI-SUPPLIER-INVOICE-CUSTOMER-001',
   current_date,200,'e1000000-0000-4000-8000-000000000104',current_date,
   'e1000000-0000-4000-8000-000000000105');
 v_retry:=public.record_customer_mandate_disbursement(
   v_org,'e1000000-0000-4000-8000-000000000088','CI-SUPPLIER-INVOICE-CUSTOMER-001',
   current_date,200,'e1000000-0000-4000-8000-000000000104',current_date,
   'e1000000-0000-4000-8000-000000000105');
 v_disbursement_second:=public.record_customer_mandate_disbursement(
   v_org,'e1000000-0000-4000-8000-000000000088','CI-SUPPLIER-INVOICE-CUSTOMER-001',
   current_date,300,'e1000000-0000-4000-8000-000000000104',current_date,
   'e1000000-0000-4000-8000-000000000109');
 IF v_retry<>v_disbursement THEN RAISE EXCEPTION 'Mandate disbursement retry is not idempotent'; END IF;
 IF (SELECT sum(amount) FROM public.customer_mandate_disbursements WHERE purchase_order_line_id='e1000000-0000-4000-8000-000000000088')<>500
    OR (SELECT sum(debit) FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id WHERE je.organization_id=v_org AND je.source_type='customer_mandate_disbursement' AND jl.account_key='PCG:467' AND jl.customer_id='e1000000-0000-4000-8000-000000000037')<>500 THEN
   RAISE EXCEPTION 'Mandate supplier payment did not post to the customer clearing account';
 END IF;
 v_reimbursement:=public.record_customer_mandate_reimbursement(
   v_org,v_disbursement,'e1000000-0000-4000-8000-000000000104',200,current_date,'CI-MANDATE-REIMB-1',
   'e1000000-0000-4000-8000-000000000106');
 v_reimbursement_retry:=public.record_customer_mandate_reimbursement(
   v_org,v_disbursement,'e1000000-0000-4000-8000-000000000104',200,current_date,'CI-MANDATE-REIMB-1',
   'e1000000-0000-4000-8000-000000000106');
 IF v_reimbursement_retry<>v_reimbursement THEN RAISE EXCEPTION 'Mandate reimbursement retry is not idempotent'; END IF;
 PERFORM public.record_customer_mandate_reimbursement(
   v_org,v_disbursement_second,'e1000000-0000-4000-8000-000000000104',300,current_date,'CI-MANDATE-REIMB-2',
   'e1000000-0000-4000-8000-000000000107');
 IF (SELECT sum(amount) FROM public.customer_mandate_reimbursements)<>500 THEN
   RAISE EXCEPTION 'Mandate customer reimbursements did not clear the exact disbursement';
 END IF;
 BEGIN
   PERFORM public.record_customer_mandate_reimbursement(v_org,v_disbursement_second,'e1000000-0000-4000-8000-000000000104',1,current_date,'CI-OVER-REIMB',
     'e1000000-0000-4000-8000-000000000108');
   RAISE EXCEPTION 'Over-reimbursement must be rejected';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Over-reimbursement must be rejected' THEN RAISE; END IF;
 END;
 SELECT balance INTO v_balance FROM public.financial_accounts WHERE id='e1000000-0000-4000-8000-000000000104';
 IF v_balance<>10000 THEN RAISE EXCEPTION 'Mandate disbursement and reimbursement did not reconcile treasury balance'; END IF;

 -- One supplier invoice is reconciled to receipts belonging to two different purchase orders.
 v_invoice:=public.record_supplier_invoice_with_tax(
   v_org,'e1000000-0000-4000-8000-000000000052','CI-SUPPLIER-MULTI-001',current_date,current_date+30,
   150,15,'recoverable','CI-VAT-DOC-001','CI multi-order supplier invoice','goods_procurement');
 v_matches:=public.reconcile_supplier_invoice_multi_order(v_org,v_invoice,jsonb_build_array(
   jsonb_build_object('goods_receipt_line_id','e1000000-0000-4000-8000-000000000083','quantity',1,'unit_price',50),
   jsonb_build_object('goods_receipt_line_id','e1000000-0000-4000-8000-000000000085','quantity',1,'unit_price',50),
   jsonb_build_object('goods_receipt_line_id','e1000000-0000-4000-8000-000000000103','quantity',1,'unit_price',50)
 ),NULL);
 IF v_matches<>2 THEN RAISE EXCEPTION 'One invoice must produce two purchase-order match headers'; END IF;
 SELECT match_status,purchase_order_number INTO v_match_status,v_orders
 FROM public.magnisa_supplier_invoice_match_reconciliation WHERE supplier_invoice_id=v_invoice;
 IF v_match_status<>'matched' OR v_orders NOT LIKE '%CI-PO-PARTIAL%' OR v_orders NOT LIKE '%CI-PO-MULTI-2%' THEN
   RAISE EXCEPTION 'Multi-order reconciliation view did not aggregate all purchase orders';
 END IF;
 IF (SELECT subtotal FROM public.supplier_invoices WHERE id=v_invoice)<>150
    OR (SELECT tax_total FROM public.supplier_invoices WHERE id=v_invoice)<>15
    OR (SELECT total FROM public.supplier_invoices WHERE id=v_invoice)<>165 THEN
   RAISE EXCEPTION 'Supplier invoice HT, VAT and TTC totals were not persisted separately';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.journal_entry_lines jl JOIN public.journal_entries je ON je.id=jl.journal_entry_id
   WHERE je.source_type='supplier_invoice' AND je.source_id=v_invoice AND jl.account_key='TAX:SUPPLIER_INPUT' AND jl.debit=15) THEN
   RAISE EXCEPTION 'Recoverable supplier VAT was not separated in the accounting entry';
 END IF;
END $;

END $;

DO $
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
