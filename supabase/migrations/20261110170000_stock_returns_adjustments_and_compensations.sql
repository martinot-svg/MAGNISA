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
 source_invoice_line_id uuid REFERENCES public.invoice_lines(id) ON DELETE RESTRICT,
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
 FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT
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
 SELECT COALESCE(SUM(rl.quantity),0) INTO v_returned
 FROM public.stock_return_lines rl JOIN public.stock_returns sr ON sr.id=rl.return_id AND sr.organization_id=rl.organization_id
 WHERE rl.organization_id=p_org AND rl.source_line_type='sales_delivery_line' AND rl.source_line_id=dl.id
   AND sr.return_type='customer' AND sr.status='posted';
 IF p_quantity>dl.quantity_delivered-v_returned+0.00000001 THEN RAISE EXCEPTION 'Le retour dépasse la quantité livrée non encore retournée'; END IF;
 v_bucket:=CASE WHEN p_condition='resalable' THEN 'resale' ELSE 'quarantine' END;
 v_cost:=dl.unit_cost;
 SELECT il.id INTO v_invoice_line FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
 WHERE il.organization_id=p_org AND il.source_order_line_id=dl.order_line_id AND inv.status IN ('issued','partially_paid','paid')
 ORDER BY inv.issue_date DESC,il.created_at DESC LIMIT 1;
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
 WHERE organization_id=p_org AND item_id=grl.item_id AND stock_location_id=p_location_id AND stock_bucket=v_bucket;
 IF v_on_hand<=0 THEN RAISE EXCEPTION 'Aucun stock physique à retourner depuis cet emplacement'; END IF;
 v_cost:=round(v_cost/v_on_hand,2);
 SELECT COALESCE(SUM(quantity_reserved-quantity_fulfilled-quantity_released),0) INTO v_reserved
 FROM public.stock_reservations WHERE organization_id=p_org AND item_id=grl.item_id AND stock_location_id=p_location_id
 AND stock_bucket='resale' AND status IN ('active','partially_fulfilled');
 IF v_on_hand-v_reserved+0.00000001<p_quantity THEN RAISE EXCEPTION 'Stock physique disponible insuffisant pour le retour fournisseur'; END IF;
 v_return:=gen_random_uuid();v_line:=gen_random_uuid();
 v_number:='SR-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_return::text,'-',''),1,8));
 INSERT INTO public.stock_returns(id,organization_id,return_number,return_type,source_document_id,request_key,reason,created_by)
 VALUES(v_return,p_org,v_number,'supplier',gr.id,p_request_key,trim(p_reason),auth.uid());
 INSERT INTO public.stock_return_lines(id,organization_id,return_id,source_line_type,source_line_id,item_id,stock_location_id,quantity,return_condition,stock_bucket,unit_cost)
 VALUES(v_line,p_org,v_return,'goods_receipt_line',grl.id,grl.item_id,p_location_id,p_quantity,'supplier_return',v_bucket,v_cost);
 INSERT INTO public.stock_movements(organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by)
 VALUES(p_org,grl.item_id,p_location_id,v_bucket,'supplier_return',-p_quantity,v_cost,'MGA','supplier_return',v_return,v_line,'supplier-return:'||v_line::text,now(),auth.uid());
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
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Motif d’annulation obligatoire'; END IF;
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
 IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Motif d’annulation obligatoire'; END IF;
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
