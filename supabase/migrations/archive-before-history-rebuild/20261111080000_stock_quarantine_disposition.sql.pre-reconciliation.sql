-- Controlled quarantine inspection and release into an approved stock bucket.
-- A release is a reclassification, not a purchase or sale: paired movements preserve
-- total quantity and carrying value and deliberately create no accounting event.
CREATE TABLE public.stock_quarantine_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  release_number text NOT NULL,
  request_key uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, release_number),
  UNIQUE (organization_id, request_key),
  UNIQUE (id, organization_id)
);

CREATE TABLE public.stock_quarantine_release_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  release_id uuid NOT NULL,
  item_id uuid NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  destination_bucket text NOT NULL CHECK (destination_bucket IN ('resale','company_use','consumption')),
  unit_cost numeric(18,2) NOT NULL CHECK (unit_cost >= 0),
  source_movement_id uuid NOT NULL,
  destination_movement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (release_id,organization_id)
    REFERENCES public.stock_quarantine_releases(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id,organization_id)
    REFERENCES public.catalog_items(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_location_id,organization_id)
    REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_location_id,organization_id)
    REFERENCES public.stock_locations(id,organization_id) ON DELETE RESTRICT,
  -- Movement IDs are immutable ledger references; stock_movements has a single-column PK.
  UNIQUE (organization_id,source_movement_id),
  UNIQUE (organization_id,destination_movement_id)
);

ALTER TABLE public.stock_quarantine_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_quarantine_release_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_quarantine_releases,public.stock_quarantine_release_lines FROM PUBLIC,anon;
CREATE POLICY stock_quarantine_releases_org_select
  ON public.stock_quarantine_releases FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY stock_quarantine_release_lines_org_select
  ON public.stock_quarantine_release_lines FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
GRANT SELECT ON public.stock_quarantine_releases,public.stock_quarantine_release_lines TO authenticated;
GRANT ALL ON public.stock_quarantine_releases,public.stock_quarantine_release_lines TO service_role;

CREATE OR REPLACE FUNCTION public.release_stock_from_quarantine(
  p_org uuid,
  p_item_id uuid,
  p_source_location_id uuid,
  p_destination_location_id uuid,
  p_quantity numeric,
  p_destination_bucket text,
  p_request_key uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $function$
DECLARE
  v_existing public.stock_quarantine_releases%rowtype;
  v_existing_line public.stock_quarantine_release_lines%rowtype;
  v_on_hand numeric;
  v_value numeric;
  v_unit_cost numeric;
  v_release uuid;
  v_line uuid;
  v_out uuid;
  v_in uuid;
  v_number text;
  v_currency text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'inventory.manage');

  IF p_quantity IS NULL OR p_quantity <= 0
     OR p_destination_bucket NOT IN ('resale','company_use','consumption')
     OR p_source_location_id = p_destination_location_id
     OR p_request_key IS NULL
     OR nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Paramètres de libération de quarantaine invalides.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org::text||':'||p_item_id::text||':'||p_source_location_id::text||':quarantine',0
  ));

  SELECT * INTO v_existing
  FROM public.stock_quarantine_releases
  WHERE organization_id=p_org AND request_key=p_request_key
  FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_existing_line
    FROM public.stock_quarantine_release_lines
    WHERE organization_id=p_org AND release_id=v_existing.id;
    IF NOT FOUND OR v_existing_line.item_id<>p_item_id
       OR v_existing_line.source_location_id<>p_source_location_id
       OR v_existing_line.destination_location_id<>p_destination_location_id
       OR v_existing_line.quantity<>p_quantity
       OR v_existing_line.destination_bucket<>p_destination_bucket
       OR v_existing.reason<>trim(p_reason) THEN
      RAISE EXCEPTION 'Clé de libération réutilisée avec des paramètres différents.';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.catalog_items
    WHERE id=p_item_id AND organization_id=p_org AND tracking_mode='quantity') THEN
    RAISE EXCEPTION 'Article suivi en quantité introuvable.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_locations
    WHERE id=p_source_location_id AND organization_id=p_org AND is_active)
     OR NOT EXISTS (SELECT 1 FROM public.stock_locations
    WHERE id=p_destination_location_id AND organization_id=p_org AND is_active) THEN
    RAISE EXCEPTION 'Emplacement source ou destination invalide.';
  END IF;

  SELECT COALESCE(sum(quantity_delta),0),
         COALESCE(sum(quantity_delta*unit_cost),0)
  INTO v_on_hand,v_value
  FROM public.stock_movements
  WHERE organization_id=p_org AND item_id=p_item_id
    AND stock_location_id=p_source_location_id AND stock_bucket='quarantine';
  IF v_on_hand + 0.00000001 < p_quantity THEN
    RAISE EXCEPTION 'Quantité quarantainée insuffisante.';
  END IF;
  IF v_on_hand <= 0 THEN
    RAISE EXCEPTION 'Aucun stock disponible en quarantaine.';
  END IF;
  v_unit_cost:=round(v_value/v_on_hand,2);
  SELECT currency INTO v_currency FROM public.organizations WHERE id=p_org;

  v_release:=gen_random_uuid();
  v_line:=gen_random_uuid();
  v_out:=gen_random_uuid();
  v_in:=gen_random_uuid();
  v_number:='QRL-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||
    upper(substr(replace(v_release::text,'-',''),1,8));

  INSERT INTO public.stock_quarantine_releases(
    id,organization_id,release_number,request_key,reason,created_by
  ) VALUES (v_release,p_org,v_number,p_request_key,trim(p_reason),auth.uid());

  INSERT INTO public.stock_movements(
    id,organization_id,item_id,stock_location_id,stock_bucket,movement_kind,
    quantity_delta,unit_cost,currency,source_type,source_id,source_line_id,event_key,
    effective_at,created_by
  ) VALUES
    (v_out,p_org,p_item_id,p_source_location_id,'quarantine','adjustment_out',
     -p_quantity,v_unit_cost,coalesce(v_currency,'MGA'),'quarantine_reclassification',
     v_release,v_line,'quarantine-release-out:'||v_line::text,now(),auth.uid()),
    (v_in,p_org,p_item_id,p_destination_location_id,p_destination_bucket,'adjustment_in',
     p_quantity,v_unit_cost,coalesce(v_currency,'MGA'),'quarantine_reclassification',
     v_release,v_line,'quarantine-release-in:'||v_line::text,now(),auth.uid());

  INSERT INTO public.stock_quarantine_release_lines(
    id,organization_id,release_id,item_id,source_location_id,destination_location_id,
    quantity,destination_bucket,unit_cost,source_movement_id,destination_movement_id
  ) VALUES (
    v_line,p_org,v_release,p_item_id,p_source_location_id,p_destination_location_id,
    p_quantity,p_destination_bucket,v_unit_cost,v_out,v_in
  );

  PERFORM public.audit_event(p_org,'stock.quarantine_released',
    'stock_quarantine_release',v_release,NULL,
    jsonb_build_object('item_id',p_item_id,'quantity',p_quantity,
      'source_location_id',p_source_location_id,
      'destination_location_id',p_destination_location_id,
      'destination_bucket',p_destination_bucket,'unit_cost',v_unit_cost));
  RETURN v_release;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_stock_from_quarantine(uuid,uuid,uuid,uuid,numeric,text,uuid,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.release_stock_from_quarantine(uuid,uuid,uuid,uuid,numeric,text,uuid,text)
  TO authenticated;
