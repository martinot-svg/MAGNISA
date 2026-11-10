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
 UNIQUE(organization_id,return_id,source_line_id),
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
 FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT
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
