-- Connect the already-defined return and adjustment rules to the durable stock journal processor.
-- Quarantined customer returns remain company inventory and therefore carry the same
-- inventory valuation entry as resalable returns; quarantine is a disposition, not a write-off.

CREATE OR REPLACE FUNCTION private.process_stock_accounting_event(
  p_organization_id uuid,p_event_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $function$
DECLARE
  e public.accounting_event_outbox%rowtype;
  v_amount numeric;
  v_debit text;
  v_credit text;
  v_lines jsonb;
  v_journal uuid;
  v_description text;
BEGIN
  SELECT * INTO e FROM public.accounting_event_outbox
  WHERE id=p_event_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Accounting event not found in this organization.'; END IF;
  IF e.status='posted' THEN RETURN e.journal_entry_id; END IF;

  v_amount:=round(COALESCE((e.payload->>'amount')::numeric,0),2);
  IF v_amount<=0 THEN
    UPDATE public.accounting_event_outbox
    SET status='posted',last_error=NULL,attempted_at=now(),posted_at=now()
    WHERE id=e.id AND organization_id=e.organization_id;
    RETURN NULL;
  END IF;

  BEGIN
    IF e.operation_type='stock_receipt' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','merchandise_stock','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','stock_variation','credit');
      v_description:='Entrée en stock de marchandises';
    ELSIF e.operation_type='stock_issue' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','stock_variation','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','merchandise_stock','credit');
      v_description:='Sortie de stock liée à une livraison client';
    ELSIF e.operation_type='stock_return' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_return','recognition','merchandise_stock','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_return','recognition','stock_variation','credit');
      v_description:='Retour client de marchandises';
    ELSIF e.operation_type='stock_supplier_return' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_supplier_return','recognition','stock_variation','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_supplier_return','recognition','merchandise_stock','credit');
      v_description:='Retour de marchandises au fournisseur';
    ELSIF e.operation_type='stock_adjustment_in' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_adjustment_in','recognition','merchandise_stock','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_adjustment_in','recognition','stock_variation','credit');
      v_description:='Ajustement positif de stock';
    ELSIF e.operation_type='stock_adjustment_out' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_adjustment_out','recognition','stock_variation','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_adjustment_out','recognition','merchandise_stock','credit');
      v_description:='Ajustement négatif de stock';
    ELSE
      RAISE EXCEPTION 'Unsupported stock accounting event type: %',e.operation_type;
    END IF;

    v_lines:=jsonb_build_array(
      jsonb_build_object('pcg_code',v_debit,'debit',v_amount,'credit',0),
      jsonb_build_object('pcg_code',v_credit,'debit',0,'credit',v_amount)
    );
    v_journal:=public.magnisa_post_journal(
      e.organization_id,(e.payload->>'effective_at')::timestamptz::date,
      'STK-'||upper(substr(replace(e.source_id::text,'-',''),1,12)),
      v_description,'stock_movement',e.source_id,v_lines
    );
    UPDATE public.accounting_event_outbox
    SET status='posted',journal_entry_id=v_journal,last_error=NULL,attempted_at=now(),posted_at=now()
    WHERE id=e.id AND organization_id=e.organization_id;
    RETURN v_journal;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.accounting_event_outbox
    SET status='pending',last_error=SQLERRM,attempted_at=now()
    WHERE id=e.id AND organization_id=e.organization_id;
    RETURN NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION private.post_stock_movement_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $function$
DECLARE
  v_operation text;
  v_amount numeric;
  v_event_id uuid;
BEGIN
  IF NEW.stock_bucket NOT IN ('resale','quarantine') THEN RETURN NEW; END IF;

  IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
    v_operation:='stock_receipt';
    v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
  ELSIF NEW.source_type='sales_delivery' AND NEW.movement_kind='issue' THEN
    v_operation:='stock_issue';
    v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
  ELSIF NEW.source_type IN ('customer_return','delivery_cancel')
    AND NEW.movement_kind IN ('customer_return','adjustment_in') THEN
    v_operation:='stock_return';
    v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
  ELSIF NEW.source_type='supplier_return' AND NEW.movement_kind='supplier_return' THEN
    v_operation:='stock_supplier_return';
    v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
  ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_in' THEN
    v_operation:='stock_adjustment_in';
    v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
  ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_out' THEN
    v_operation:='stock_adjustment_out';
    v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.accounting_event_outbox(
    organization_id,source_type,source_id,event_type,operation_type,payload
  ) VALUES (
    NEW.organization_id,'stock_movement',NEW.id,v_operation,v_operation,
    jsonb_build_object('movement_id',NEW.id,'item_id',NEW.item_id,
      'stock_location_id',NEW.stock_location_id,'stock_bucket',NEW.stock_bucket,
      'quantity',abs(NEW.quantity_delta),'unit_cost',NEW.unit_cost,
      'amount',v_amount,'effective_at',NEW.effective_at)
  )
  ON CONFLICT(organization_id,source_type,source_id,event_type) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.accounting_event_outbox
    WHERE organization_id=NEW.organization_id AND source_type='stock_movement'
      AND source_id=NEW.id AND event_type=v_operation;
  END IF;
  PERFORM private.process_stock_accounting_event(NEW.organization_id,v_event_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_movements_accounting_post ON public.stock_movements;
CREATE TRIGGER stock_movements_accounting_post
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION private.post_stock_movement_accounting();

REVOKE ALL ON FUNCTION private.process_stock_accounting_event(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.process_stock_accounting_event(uuid,uuid) TO authenticated;
