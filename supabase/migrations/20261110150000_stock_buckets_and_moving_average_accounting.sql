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
