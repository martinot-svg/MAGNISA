-- Internal-use and consumable stock is held in class 32 until it is issued.
-- The expense account is selected per catalogue item and must agree with the matched supplier invoice.
ALTER TABLE public.catalog_items
  ADD COLUMN IF NOT EXISTS internal_expense_account_code text
  REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.validate_catalog_internal_expense_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE v_kind text;
BEGIN
  IF NEW.internal_expense_account_code IS NOT NULL THEN
    SELECT kind INTO v_kind FROM public.pcg2005_accounts
    WHERE code=NEW.internal_expense_account_code;
    IF v_kind IS DISTINCT FROM 'expense' THEN
      RAISE EXCEPTION 'Le compte d’usage interne doit être un compte de charge PCG.';
    END IF;
    IF NEW.item_kind='equipment' THEN
      RAISE EXCEPTION 'Un équipement durable doit être traité dans le registre des immobilisations, pas comme une fourniture consommable.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS catalog_items_validate_internal_expense_account ON public.catalog_items;
CREATE TRIGGER catalog_items_validate_internal_expense_account
BEFORE INSERT OR UPDATE OF internal_expense_account_code,item_kind
ON public.catalog_items
FOR EACH ROW EXECUTE FUNCTION private.validate_catalog_internal_expense_account();

CREATE OR REPLACE FUNCTION private.validate_purchase_order_internal_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE v_kind text;v_account text;
BEGIN
  IF NEW.purchase_purpose IN ('company_use','consumption') THEN
    SELECT internal_expense_account_code,item_kind INTO v_account,v_kind
    FROM public.catalog_items WHERE id=NEW.item_id AND organization_id=NEW.organization_id;
    IF v_account IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.pcg2005_accounts WHERE code=v_account AND kind='expense'
    ) THEN
      RAISE EXCEPTION 'Un compte de charge PCG doit être défini sur l’article avant un achat interne ou consommable.';
    END IF;
    IF v_kind='equipment' THEN
      RAISE EXCEPTION 'Un équipement durable doit être traité comme immobilisation, pas comme fourniture de stock interne.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS purchase_order_lines_validate_internal_account ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_validate_internal_account
BEFORE INSERT OR UPDATE OF purchase_purpose,item_id
ON public.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION private.validate_purchase_order_internal_account();

CREATE TABLE public.stock_internal_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  issue_number text NOT NULL,
  request_key uuid NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason))>=3),
  status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','cancelled')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,issue_number),
  UNIQUE(organization_id,request_key),
  UNIQUE(id,organization_id)
);
CREATE TABLE public.stock_internal_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  issue_id uuid NOT NULL,
  item_id uuid NOT NULL,
  stock_location_id uuid NOT NULL,
  stock_bucket text NOT NULL CHECK(stock_bucket IN ('company_use','consumption')),
  quantity numeric(18,4) NOT NULL CHECK(quantity>0),
  unit_cost numeric(18,2) NOT NULL CHECK(unit_cost>=0),
  movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(issue_id,organization_id) REFERENCES public.stock_internal_issues(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(item_id,organization_id) REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY(stock_location_id,organization_id) REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT
);
ALTER TABLE public.stock_internal_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_internal_issue_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_internal_issues,public.stock_internal_issue_lines FROM PUBLIC,anon;
CREATE POLICY stock_internal_issues_org_select ON public.stock_internal_issues
  FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
CREATE POLICY stock_internal_issue_lines_org_select ON public.stock_internal_issue_lines
  FOR SELECT TO authenticated USING(public.is_org_member(organization_id));
GRANT SELECT ON public.stock_internal_issues,public.stock_internal_issue_lines TO authenticated;
GRANT ALL ON public.stock_internal_issues,public.stock_internal_issue_lines TO service_role;

CREATE OR REPLACE FUNCTION public.post_internal_stock_issue(
  p_org uuid,p_item_id uuid,p_location_id uuid,p_stock_bucket text,
  p_quantity numeric,p_reason text,p_request_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $function$
DECLARE
  v_existing public.stock_internal_issues%rowtype;
  v_existing_line public.stock_internal_issue_lines%rowtype;
  v_item public.catalog_items%rowtype;
  v_on_hand numeric;
  v_value numeric;
  v_cost numeric;
  v_issue uuid;
  v_line uuid;
  v_movement uuid;
  v_number text;
  v_currency text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org) THEN RAISE EXCEPTION 'Accès refusé.'; END IF;
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'inventory.manage');
  IF p_quantity IS NULL OR p_quantity<=0 OR p_stock_bucket NOT IN ('company_use','consumption')
     OR p_request_key IS NULL OR length(trim(coalesce(p_reason,'')))<3 THEN
    RAISE EXCEPTION 'Paramètres de sortie interne invalides.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org::text||':'||p_item_id::text||':'||p_location_id::text||':'||p_stock_bucket,0
  ));
  SELECT * INTO v_existing FROM public.stock_internal_issues
  WHERE organization_id=p_org AND request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_existing_line FROM public.stock_internal_issue_lines
    WHERE organization_id=p_org AND issue_id=v_existing.id;
    IF NOT FOUND OR v_existing_line.item_id<>p_item_id
       OR v_existing_line.stock_location_id<>p_location_id
       OR v_existing_line.stock_bucket<>p_stock_bucket
       OR v_existing_line.quantity<>p_quantity OR v_existing.reason<>trim(p_reason) THEN
      RAISE EXCEPTION 'Clé de sortie interne réutilisée avec des paramètres différents.';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_item FROM public.catalog_items
  WHERE id=p_item_id AND organization_id=p_org AND is_active AND tracking_mode='quantity' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Article suivi en quantité introuvable.'; END IF;
  IF v_item.item_kind='equipment' THEN RAISE EXCEPTION 'Un équipement durable doit être sorti via le registre des immobilisations.'; END IF;
  IF v_item.internal_expense_account_code IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.pcg2005_accounts WHERE code=v_item.internal_expense_account_code AND kind='expense'
  ) THEN RAISE EXCEPTION 'Le compte de charge PCG doit être défini sur la fiche article avant la sortie.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stock_locations WHERE id=p_location_id AND organization_id=p_org AND is_active) THEN
    RAISE EXCEPTION 'Emplacement de stock invalide.';
  END IF;
  SELECT COALESCE(sum(quantity_delta),0),COALESCE(sum(quantity_delta*unit_cost),0)
  INTO v_on_hand,v_value FROM public.stock_movements
  WHERE organization_id=p_org AND item_id=p_item_id AND stock_location_id=p_location_id AND stock_bucket=p_stock_bucket;
  IF v_on_hand+0.00000001<p_quantity THEN RAISE EXCEPTION 'Stock interne disponible insuffisant.'; END IF;
  IF v_on_hand<=0 THEN RAISE EXCEPTION 'Aucun stock interne disponible.'; END IF;
  v_cost:=round(v_value/v_on_hand,2);
  SELECT currency INTO v_currency FROM public.organizations WHERE id=p_org;
  v_issue:=gen_random_uuid();v_line:=gen_random_uuid();v_movement:=gen_random_uuid();
  v_number:='ISS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(v_issue::text,'-',''),1,8));
  INSERT INTO public.stock_internal_issues(id,organization_id,issue_number,request_key,reason,created_by)
  VALUES(v_issue,p_org,v_number,p_request_key,trim(p_reason),auth.uid());
  INSERT INTO public.stock_internal_issue_lines(id,organization_id,issue_id,item_id,stock_location_id,stock_bucket,quantity,unit_cost)
  VALUES(v_line,p_org,v_issue,p_item_id,p_location_id,p_stock_bucket,p_quantity,v_cost);
  INSERT INTO public.stock_movements(
    id,organization_id,item_id,stock_location_id,stock_bucket,movement_kind,quantity_delta,
    unit_cost,currency,source_type,source_id,source_line_id,event_key,effective_at,created_by
  ) VALUES(
    v_movement,p_org,p_item_id,p_location_id,p_stock_bucket,'issue',-p_quantity,v_cost,
    coalesce(v_currency,'MGA'),'internal_stock_issue',v_issue,v_line,
    'internal-stock-issue:'||v_line::text,now(),auth.uid()
  );
  UPDATE public.stock_internal_issue_lines SET movement_id=v_movement
  WHERE id=v_line AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'stock.internal_issue_posted','stock_internal_issue',v_issue,NULL,
    jsonb_build_object('item_id',p_item_id,'location_id',p_location_id,'bucket',p_stock_bucket,
      'quantity',p_quantity,'unit_cost',v_cost,'expense_account_code',v_item.internal_expense_account_code));
  RETURN v_issue;
END;
$function$;

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
  v_expense_code text;
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
    IF e.operation_type IN ('stock_internal_receipt','stock_internal_adjustment_in') THEN
      SELECT internal_expense_account_code INTO v_expense_code FROM public.catalog_items
      WHERE id=(e.payload->>'item_id')::uuid AND organization_id=e.organization_id;
      IF v_expense_code IS NULL OR NOT EXISTS(SELECT 1 FROM public.pcg2005_accounts WHERE code=v_expense_code AND kind='expense') THEN
        RAISE EXCEPTION 'Compte de charge interne absent ou invalide sur la fiche article.';
      END IF;
      v_debit:='32';v_credit:=v_expense_code;
      v_description:=CASE WHEN e.operation_type='stock_internal_receipt'
        THEN 'Entrée en stock de fournitures destinées à l’usage interne'
        ELSE 'Ajustement positif du stock interne' END;
    ELSIF e.operation_type IN ('stock_internal_issue','stock_internal_supplier_return','stock_internal_adjustment_out') THEN
      SELECT internal_expense_account_code INTO v_expense_code FROM public.catalog_items
      WHERE id=(e.payload->>'item_id')::uuid AND organization_id=e.organization_id;
      IF v_expense_code IS NULL OR NOT EXISTS(SELECT 1 FROM public.pcg2005_accounts WHERE code=v_expense_code AND kind='expense') THEN
        RAISE EXCEPTION 'Compte de charge interne absent ou invalide sur la fiche article.';
      END IF;
      v_debit:=v_expense_code;v_credit:='32';
      v_description:=CASE e.operation_type
        WHEN 'stock_internal_issue' THEN 'Consommation de fournitures internes'
        WHEN 'stock_internal_supplier_return' THEN 'Retour fournisseur de fournitures internes'
        ELSE 'Ajustement négatif du stock interne' END;
    ELSIF e.operation_type='stock_receipt' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','merchandise_stock','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_receipt','recognition','stock_variation','credit');
      v_description:='Entrée en stock de marchandises';
    ELSIF e.operation_type='stock_issue' THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','stock_variation','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,'stock_issue','recognition','merchandise_stock','credit');
      v_description:='Sortie de stock liée à une livraison client';
    ELSIF e.operation_type IN ('stock_return','stock_adjustment_in') THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','merchandise_stock','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','stock_variation','credit');
      v_description:=CASE WHEN e.operation_type='stock_return' THEN 'Retour client de marchandises' ELSE 'Ajustement positif de stock' END;
    ELSIF e.operation_type IN ('stock_supplier_return','stock_adjustment_out') THEN
      v_debit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','stock_variation','debit');
      v_credit:=public.magnisa_resolve_pcg_account(e.organization_id,e.operation_type,'recognition','merchandise_stock','credit');
      v_description:=CASE WHEN e.operation_type='stock_supplier_return' THEN 'Retour de marchandises au fournisseur' ELSE 'Ajustement négatif de stock' END;
    ELSE
      RAISE EXCEPTION 'Unsupported stock accounting event type: %',e.operation_type;
    END IF;
    v_lines:=jsonb_build_array(
      jsonb_build_object('account_kind','pcg','pcg_code',v_debit,'debit',v_amount,'credit',0),
      jsonb_build_object('account_kind','pcg','pcg_code',v_credit,'debit',0,'credit',v_amount)
    );
    v_journal:=public.magnisa_post_journal(
      e.organization_id,(e.payload->>'effective_at')::timestamptz::date,
      'STK-'||upper(substr(replace(e.source_id::text,'-',''),1,12)),
      v_description,'stock_movement',e.source_id,v_lines
    );
    UPDATE public.accounting_event_outbox SET status='posted',journal_entry_id=v_journal,last_error=NULL,attempted_at=now(),posted_at=now()
    WHERE id=e.id AND organization_id=e.organization_id;
    RETURN v_journal;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.accounting_event_outbox SET status='pending',last_error=SQLERRM,attempted_at=now()
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
  IF NEW.stock_bucket IN ('company_use','consumption') THEN
    IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
      v_operation:='stock_internal_receipt';v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
    ELSIF NEW.source_type='internal_stock_issue' AND NEW.movement_kind='issue' THEN
      v_operation:='stock_internal_issue';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='supplier_return' AND NEW.movement_kind='supplier_return' THEN
      v_operation:='stock_internal_supplier_return';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_in' THEN
      v_operation:='stock_internal_adjustment_in';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_out' THEN
      v_operation:='stock_internal_adjustment_out';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.stock_bucket NOT IN ('resale','quarantine') THEN RETURN NEW; END IF;
    IF NEW.source_type='goods_receipt' AND NEW.movement_kind='receipt' THEN
      v_operation:='stock_receipt';v_amount:=round(NEW.quantity_delta*NEW.unit_cost,2);
    ELSIF NEW.source_type='sales_delivery' AND NEW.movement_kind='issue' THEN
      v_operation:='stock_issue';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type IN ('customer_return','delivery_cancel') AND NEW.movement_kind IN ('customer_return','adjustment_in') THEN
      v_operation:='stock_return';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='supplier_return' AND NEW.movement_kind='supplier_return' THEN
      v_operation:='stock_supplier_return';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_in' THEN
      v_operation:='stock_adjustment_in';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSIF NEW.source_type='stock_adjustment' AND NEW.movement_kind='adjustment_out' THEN
      v_operation:='stock_adjustment_out';v_amount:=round(abs(NEW.quantity_delta)*NEW.unit_cost,2);
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO public.accounting_event_outbox(
    organization_id,source_type,source_id,event_type,operation_type,payload
  ) VALUES (
    NEW.organization_id,'stock_movement',NEW.id,v_operation,v_operation,
    jsonb_build_object('movement_id',NEW.id,'item_id',NEW.item_id,
      'stock_location_id',NEW.stock_location_id,'stock_bucket',NEW.stock_bucket,
      'quantity',abs(NEW.quantity_delta),'unit_cost',NEW.unit_cost,
      'amount',v_amount,'effective_at',NEW.effective_at)
  ) ON CONFLICT(organization_id,source_type,source_id,event_type) DO NOTHING
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

CREATE OR REPLACE FUNCTION private.validate_supplier_invoice_stock_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_invoice uuid;
  v_expense_code text;
  v_purpose text;
  v_internal_code text;
BEGIN
  SELECT supplier_invoice_id INTO v_invoice FROM public.supplier_invoice_matches
  WHERE id=NEW.match_id AND organization_id=NEW.organization_id;
  SELECT expense_account_code INTO v_expense_code FROM public.supplier_invoices
  WHERE id=v_invoice AND organization_id=NEW.organization_id;
  SELECT pol.purchase_purpose,ci.internal_expense_account_code
  INTO v_purpose,v_internal_code
  FROM public.goods_receipt_lines grl
  JOIN public.purchase_order_lines pol ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
  JOIN public.catalog_items ci ON ci.id=pol.item_id AND ci.organization_id=pol.organization_id
  WHERE grl.id=NEW.goods_receipt_line_id AND grl.organization_id=NEW.organization_id;
  IF v_purpose IN ('company_use','consumption') THEN
    IF v_internal_code IS NULL OR v_expense_code IS DISTINCT FROM v_internal_code THEN
      RAISE EXCEPTION 'Le compte de charge de la facture doit correspondre au compte d’usage interne défini sur chaque article rapproché.';
    END IF;
  ELSIF v_purpose='resale' AND v_expense_code IS DISTINCT FROM '607' THEN
    RAISE EXCEPTION 'Une facture de marchandises destinées à la revente doit être imputée au compte 607.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS supplier_invoice_match_lines_validate_stock_account ON public.supplier_invoice_match_lines;
CREATE TRIGGER supplier_invoice_match_lines_validate_stock_account
BEFORE INSERT OR UPDATE OF match_id,goods_receipt_line_id
ON public.supplier_invoice_match_lines
FOR EACH ROW EXECUTE FUNCTION private.validate_supplier_invoice_stock_account();

REVOKE ALL ON FUNCTION public.post_internal_stock_issue(uuid,uuid,uuid,text,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_internal_stock_issue(uuid,uuid,uuid,text,numeric,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.process_stock_accounting_event(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.process_stock_accounting_event(uuid,uuid) TO authenticated;
