-- Mixed service / merchandise billing from delivered order quantities.
-- Revenue is posted by line nature through the versioned accounting rules.
INSERT INTO public.accounting_posting_rules(operation_type,event_type,operation_key,debit_account_code,credit_account_code,priority,valid_from)
VALUES
 ('invoice','recognition','customer_receivable','411',NULL,100,current_date),
 ('invoice','recognition','service_revenue',NULL,'706',100,current_date),
 ('invoice','recognition','merchandise_revenue',NULL,'707',100,current_date),
 ('invoice','recognition','ancillary_revenue',NULL,'708',100,current_date),
 ('invoice','recognition','tax_payable',NULL,'445',100,current_date)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(
 p_org uuid,p_customer uuid,p_due_date date,p_lines jsonb,p_order uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE
 v_invoice uuid;v_number text;r jsonb;s public.services%rowtype;ol public.order_lines%rowtype;
 v_order public.orders%rowtype;q numeric;d numeric;unit_price numeric;tax_rate numeric;
 v_description text;v_unit text;v_kind text;v_item uuid;v_order_line_id uuid;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;
 v_sub numeric:=0;v_disc numeric:=0;v_tax numeric:=0;v_total numeric:=0;v_sort integer:=1;
 v_billed numeric;v_remaining numeric;v_seen_order_lines uuid[]:=ARRAY[]::uuid[];
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_due_date IS NULL OR p_due_date<current_date THEN RAISE EXCEPTION 'Échéance invalide'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1 OR jsonb_array_length(p_lines)>100 THEN
  RAISE EXCEPTION 'La facture doit contenir entre 1 et 100 lignes';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer AND organization_id=p_org AND is_active) THEN
  RAISE EXCEPTION 'Client invalide';
 END IF;
 IF p_order IS NOT NULL THEN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_order.customer_id<>p_customer OR v_order.status NOT IN ('confirmed','in_progress','completed') THEN
   RAISE EXCEPTION 'Commande ou client invalide';
  END IF;
 END IF;

 -- Validate all lines and remaining quantities before creating the invoice header.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=COALESCE((r->>'quantity')::numeric,0);
  d:=COALESCE((r->>'discount_pct')::numeric,0);
  v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF q<=0 OR d<0 OR d>100 THEN RAISE EXCEPTION 'Ligne de facture invalide'; END IF;

  IF v_kind='service' THEN
   IF NULLIF(r->>'service_id','') IS NULL THEN RAISE EXCEPTION 'Prestation manquante'; END IF;
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestation invalide'; END IF;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   IF unit_price<0 THEN RAISE EXCEPTION 'Prix unitaire invalide'; END IF;
   tax_rate:=s.tax_rate;v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF p_order IS NOT NULL THEN
    IF v_order_line_id IS NULL OR v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Chaque prestation d’une commande doit être rattachée une seule fois à sa ligne source'; END IF;
    SELECT * INTO ol FROM public.order_lines
     WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order AND service_id=s.id AND line_kind='service' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de prestation source invalide'; END IF;
    SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
     FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
     WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
    v_remaining:=ol.quantity-v_billed;
    IF q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse le reliquat de la prestation'; END IF;
    tax_rate:=ol.tax_rate;v_description:=ol.description;v_unit:=ol.unit;
    v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
   ELSIF v_order_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ligne source fournie sans commande';
   END IF;
  ELSIF v_kind='merchandise' THEN
   IF p_order IS NULL OR v_order_line_id IS NULL OR NULLIF(r->>'item_id','') IS NULL THEN
    RAISE EXCEPTION 'Une marchandise doit provenir d’une ligne de commande client';
   END IF;
   IF v_order_line_id=ANY(v_seen_order_lines) THEN RAISE EXCEPTION 'Une ligne de commande ne peut apparaître qu’une fois par facture'; END IF;
   SELECT * INTO ol FROM public.order_lines
    WHERE id=v_order_line_id AND organization_id=p_org AND order_id=p_order
      AND item_id=(r->>'item_id')::uuid AND line_kind='merchandise' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de marchandise source invalide'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND inv.status<>'cancelled';
   v_remaining:=ol.delivered_quantity-v_billed;
   IF v_remaining<=0 OR q>v_remaining+0.00000001 THEN RAISE EXCEPTION 'La quantité facturée dépasse les marchandises effectivement livrées et non encore facturées'; END IF;
   unit_price:=ol.unit_price;d:=ol.discount_pct;tax_rate:=ol.tax_rate;
   v_description:=ol.description;v_unit:=ol.unit;v_item:=ol.item_id;
   v_seen_order_lines:=array_append(v_seen_order_lines,ol.id);
  ELSE
   RAISE EXCEPTION 'Nature de ligne de facture non prise en charge';
  END IF;

  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  v_sub:=v_sub+taxable;v_disc:=v_disc+disc;v_tax:=v_tax+tax;v_total:=v_total+total;
 END LOOP;

 v_number:=public.next_document_number(p_org,'invoice');
 INSERT INTO public.invoices(organization_id,customer_id,order_id,number,status,issue_date,due_date,subtotal,discount_total,tax_total,total,paid_amount,balance_due,created_by)
 VALUES(p_org,p_customer,p_order,v_number,'draft',current_date,p_due_date,v_sub,v_disc,v_tax,v_total,0,v_total,auth.uid())
 RETURNING id INTO v_invoice;

 -- Rebuild the validated snapshot and persist the mixed invoice lines.
 FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_kind:=COALESCE(NULLIF(r->>'line_kind',''),'service');
  q:=(r->>'quantity')::numeric;v_order_line_id:=NULLIF(r->>'order_line_id','')::uuid;
  IF v_kind='service' THEN
   SELECT * INTO s FROM public.services WHERE id=(r->>'service_id')::uuid AND organization_id=p_org AND is_active;
   unit_price:=COALESCE(NULLIF(r->>'unit_price','')::numeric,s.unit_price);
   d:=COALESCE((r->>'discount_pct')::numeric,0);tax_rate:=s.tax_rate;
   v_description:=s.name;v_unit:=s.unit;v_item:=NULL;
   IF v_order_line_id IS NOT NULL THEN
    SELECT ol.tax_rate,ol.description,ol.unit INTO tax_rate,v_description,v_unit FROM public.order_lines ol
    WHERE ol.id=v_order_line_id AND ol.organization_id=p_org AND ol.order_id=p_order AND ol.service_id=s.id;
   END IF;
  ELSE
   SELECT ol.unit_price,ol.discount_pct,ol.tax_rate,ol.description,ol.unit,ol.item_id
    INTO unit_price,d,tax_rate,v_description,v_unit,v_item
   FROM public.order_lines ol WHERE ol.id=v_order_line_id AND ol.organization_id=p_org AND ol.order_id=p_order;
  END IF;
  gross:=round(q*unit_price,2);disc:=round(gross*d/100,2);taxable:=gross-disc;
  tax:=round(taxable*tax_rate/100,2);total:=taxable+tax;
  INSERT INTO public.invoice_lines(organization_id,invoice_id,service_id,item_id,line_kind,source_order_line_id,description,quantity,unit,unit_price,discount_pct,discount_amount,taxable_amount,tax_rate,tax_amount,line_total,sort_order)
  VALUES(p_org,v_invoice,CASE WHEN v_kind='service' THEN s.id ELSE NULL END,v_item,v_kind,v_order_line_id,
    v_description,q,v_unit,unit_price,d,disc,taxable,tax_rate,tax,total,v_sort);
  v_sort:=v_sort+1;
 END LOOP;
 PERFORM public.audit_event(p_org,'invoice.created_draft','invoice',v_invoice,NULL,
  jsonb_build_object('number',v_number,'order_id',p_order,'lines',jsonb_array_length(p_lines),'total',v_total));
 RETURN v_invoice;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_org uuid,p_invoice uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE i public.invoices%rowtype; r record; v_lines jsonb; v_key text; v_account text; v_order_line public.order_lines%rowtype; v_billed numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.issue');
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 IF i.status<>'draft' THEN RAISE EXCEPTION 'Seule une facture brouillon peut être émise'; END IF;
 IF i.total<=0 THEN RAISE EXCEPTION 'Total invalide'; END IF;

 -- Revalidate delivery and remaining order quantities immediately before posting.
 FOR r IN SELECT * FROM public.invoice_lines WHERE organization_id=p_org AND invoice_id=i.id LOOP
  IF r.source_order_line_id IS NOT NULL THEN
   SELECT * INTO v_order_line FROM public.order_lines WHERE id=r.source_order_line_id AND organization_id=p_org FOR UPDATE;
   IF NOT FOUND OR v_order_line.order_id IS DISTINCT FROM i.order_id THEN RAISE EXCEPTION 'Ligne de commande source introuvable ou étrangère à la commande de la facture'; END IF;
   IF r.line_kind='service' AND v_order_line.service_id IS DISTINCT FROM r.service_id THEN RAISE EXCEPTION 'Prestation source incohérente'; END IF;
   IF r.line_kind='merchandise' AND v_order_line.item_id IS DISTINCT FROM r.item_id THEN RAISE EXCEPTION 'Marchandise source incohérente'; END IF;
   SELECT COALESCE(SUM(il.quantity),0) INTO v_billed
    FROM public.invoice_lines il JOIN public.invoices inv ON inv.id=il.invoice_id AND inv.organization_id=il.organization_id
    WHERE il.organization_id=p_org AND il.source_order_line_id=r.source_order_line_id
      AND il.invoice_id<>i.id AND inv.status<>'cancelled';
   IF r.line_kind='merchandise' AND r.quantity>v_order_line.delivered_quantity-v_billed+0.00000001 THEN
    RAISE EXCEPTION 'Une marchandise de la facture n’est plus intégralement livrée ou disponible à facturer';
   ELSIF r.line_kind='service' AND r.quantity>v_order_line.quantity-v_billed+0.00000001 THEN
    RAISE EXCEPTION 'Une prestation de la facture dépasse le reliquat de commande';
   END IF;
  ELSIF r.line_kind='merchandise' THEN
   RAISE EXCEPTION 'Une marchandise doit rester rattachée à une commande client';
  END IF;
 END LOOP;

 v_lines:=jsonb_build_array(jsonb_build_object(
  'pcg_code',public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','customer_receivable','debit'),
  'debit',i.total,'credit',0,'customer_id',i.customer_id
 ));
 FOR r IN
  SELECT CASE
    WHEN line_kind='service' THEN 'service_revenue'
    WHEN line_kind='fee' THEN 'ancillary_revenue'
    WHEN item_id IS NOT NULL OR line_kind IN ('merchandise','equipment','consumable') THEN 'merchandise_revenue'
    ELSE 'ancillary_revenue'
   END AS operation_key,
   SUM(taxable_amount) AS amount
  FROM public.invoice_lines
  WHERE organization_id=p_org AND invoice_id=i.id
  GROUP BY 1
 LOOP
  IF r.amount>0 THEN
   v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition',r.operation_key,'credit');
   v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
    'pcg_code',v_account,'debit',0,'credit',r.amount,'customer_id',i.customer_id
   ));
  END IF;
 END LOOP;
 IF i.tax_total>0 THEN
  v_account:=public.magnisa_resolve_pcg_account(p_org,'invoice','recognition','tax_payable','credit');
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
   'pcg_code',v_account,'debit',0,'credit',i.tax_total,'customer_id',i.customer_id
  ));
 END IF;

 UPDATE public.invoices SET status='issued',issued_at=now(),balance_due=total-paid_amount,updated_at=now()
 WHERE id=i.id AND organization_id=p_org;
 PERFORM public.magnisa_post_journal(p_org,i.issue_date,i.number,'Émission facture '||i.number,'invoice',i.id,v_lines);
 PERFORM public.audit_event(p_org,'invoice.issued','invoice',i.id,jsonb_build_object('status','draft'),jsonb_build_object('status','issued'));
END;
$function$;


CREATE OR REPLACE FUNCTION public.update_invoice_line(p_org uuid,p_line uuid,p_quantity numeric,p_discount_pct numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public
AS $function$
DECLARE l public.invoice_lines%rowtype;ol public.order_lines%rowtype;
 gross numeric;disc numeric;taxable numeric;tax numeric;total numeric;inv uuid;billed numeric;
BEGIN
 PERFORM public.assert_org_access(p_org);
 PERFORM public.assert_org_permission(p_org,'invoices.create');
 IF p_quantity IS NULL OR p_quantity<=0 OR p_discount_pct IS NULL OR p_discount_pct<0 OR p_discount_pct>100 THEN
  RAISE EXCEPTION 'Quantité ou remise invalide';
 END IF;
 SELECT * INTO l FROM public.invoice_lines WHERE id=p_line AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de facture introuvable'; END IF;
 IF l.line_kind<>'service' THEN RAISE EXCEPTION 'Les lignes de marchandises sont figées sur le prix et la quantité de la commande livrée'; END IF;
 inv:=l.invoice_id;
 IF NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=inv AND organization_id=p_org AND status='draft') THEN
  RAISE EXCEPTION 'Seule une facture brouillon peut être modifiée';
 END IF;
 IF l.source_order_line_id IS NOT NULL THEN
  SELECT * INTO ol FROM public.order_lines WHERE id=l.source_order_line_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne de commande source introuvable'; END IF;
  SELECT COALESCE(SUM(il.quantity),0) INTO billed
   FROM public.invoice_lines il JOIN public.invoices i ON i.id=il.invoice_id AND i.organization_id=il.organization_id
   WHERE il.organization_id=p_org AND il.source_order_line_id=ol.id AND il.invoice_id<>inv AND i.status<>'cancelled';
  IF p_quantity>ol.quantity-billed+0.00000001 THEN RAISE EXCEPTION 'La quantité dépasse le reliquat de prestation non facturé'; END IF;
 END IF;
 gross:=round(p_quantity*l.unit_price,2);disc:=round(gross*p_discount_pct/100,2);taxable:=gross-disc;
 tax:=round(taxable*l.tax_rate/100,2);total:=taxable+tax;
 UPDATE public.invoice_lines SET quantity=p_quantity,discount_pct=p_discount_pct,discount_amount=disc,taxable_amount=taxable,tax_amount=tax,line_total=total
 WHERE id=l.id AND organization_id=p_org;
 UPDATE public.invoices i SET subtotal=x.subtotal,discount_total=x.discount_total,tax_total=x.tax_total,total=x.total,balance_due=x.total-i.paid_amount,updated_at=now()
 FROM (SELECT invoice_id,sum(taxable_amount) subtotal,sum(discount_amount) discount_total,sum(tax_amount) tax_total,sum(line_total) total
       FROM public.invoice_lines WHERE invoice_id=inv GROUP BY invoice_id) x
 WHERE i.id=inv AND i.organization_id=p_org;
END;
$function$;
