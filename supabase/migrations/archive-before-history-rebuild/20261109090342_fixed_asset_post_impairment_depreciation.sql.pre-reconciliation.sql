-- Recalculate depreciation prospectively from the carrying amount after impairment.
-- The statutory PCG register remains authoritative; this migration only changes future schedules.
DROP POLICY IF EXISTS fixed_asset_depreciation_entries_select ON public.fixed_asset_depreciation_entries;
CREATE POLICY fixed_asset_depreciation_entries_select
  ON public.fixed_asset_depreciation_entries FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));

CREATE OR REPLACE FUNCTION public.magnisa_fixed_asset_month_units(
  p_service_date date,p_start date,p_end_exclusive date,p_useful_months integer
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  v_month integer;
  v_month_start date;
  v_month_end date;
  v_overlap_start date;
  v_overlap_end date;
  v_units numeric := 0;
BEGIN
  IF p_service_date IS NULL OR p_start IS NULL OR p_end_exclusive IS NULL OR p_useful_months<=0 THEN
    RAISE EXCEPTION 'Paramètres de durée d’amortissement invalides';
  END IF;
  IF p_end_exclusive<=greatest(p_start,p_service_date) THEN RETURN 0; END IF;
  FOR v_month IN 0..(p_useful_months-1) LOOP
    v_month_start := (p_service_date + make_interval(months => v_month))::date;
    v_month_end := (p_service_date + make_interval(months => v_month+1))::date;
    v_overlap_start := greatest(p_start,p_service_date,v_month_start);
    v_overlap_end := least(p_end_exclusive,v_month_end);
    IF v_overlap_end>v_overlap_start THEN
      v_units := v_units + ((v_overlap_end-v_overlap_start)::numeric/(v_month_end-v_month_start)::numeric);
    END IF;
    EXIT WHEN v_month_end>=p_end_exclusive;
  END LOOP;
  RETURN least(p_useful_months,v_units);
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_fixed_asset_period_charge(
  p_opening_net_book_value numeric,p_residual_value numeric,
  p_service_date date,p_useful_months integer,
  p_period_start date,p_period_end date
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE
  v_remaining_units numeric;
  v_period_units numeric;
  v_remaining_amount numeric;
BEGIN
  IF p_opening_net_book_value IS NULL OR p_residual_value IS NULL
     OR p_opening_net_book_value<0 OR p_residual_value<0
     OR p_useful_months<=0 OR p_period_start IS NULL OR p_period_end<p_period_start THEN
    RAISE EXCEPTION 'Valeurs d’ouverture ou période d’amortissement invalides';
  END IF;
  v_remaining_units := greatest(0,p_useful_months-
    public.magnisa_fixed_asset_month_units(p_service_date,p_service_date,p_period_start,p_useful_months));
  v_period_units := public.magnisa_fixed_asset_month_units(
    p_service_date,p_period_start,p_period_end+1,p_useful_months);
  v_remaining_amount := greatest(0,p_opening_net_book_value-p_residual_value);
  IF v_remaining_units<=0 OR v_period_units<=0 OR v_remaining_amount<=0 THEN RETURN 0; END IF;
  RETURN round(least(v_remaining_amount,v_remaining_amount*v_period_units/v_remaining_units),2);
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_plan_fixed_asset_depreciation(
  p_org uuid,p_asset uuid,p_period_start date,p_period_end date
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_id uuid;
  v_gross numeric(18,2);
  v_base numeric(18,2);
  v_life_end date;
  v_opening numeric(18,2);
  v_opening_net numeric(18,2);
  v_closing numeric(18,2);
  v_charge numeric(18,2);
  v_closing_net numeric(18,2);
  v_last_period_end date;
  v_remaining_units numeric;
  v_period_units numeric;
  v_details jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end<p_period_start THEN
    RAISE EXCEPTION 'Période d’amortissement invalide';
  END IF;
  SELECT * INTO a FROM public.fixed_assets
  WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' THEN RAISE EXCEPTION 'Immobilisation absente ou inactive'; END IF;
  IF a.depreciation_method<>'straight_line' OR coalesce(a.useful_life_months,0)<=0 THEN
    RAISE EXCEPTION 'Cette immobilisation ne possède pas de plan linéaire valide';
  END IF;
  IF a.in_service_date IS NULL THEN RAISE EXCEPTION 'La date de mise en service est obligatoire'; END IF;

  SELECT id INTO v_id FROM public.fixed_asset_depreciation_entries
  WHERE organization_id=p_org AND fixed_asset_id=p_asset AND status='posted'
    AND period_start=p_period_start AND period_end=p_period_end;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=p_asset AND status IN ('posted','reversed')
      AND daterange(period_start,period_end,'[]') && daterange(p_period_start,p_period_end,'[]')) THEN
    RAISE EXCEPTION 'La période chevauche une dotation déjà comptabilisée';
  END IF;
  SELECT max(period_end) INTO v_last_period_end
  FROM public.fixed_asset_depreciation_entries
  WHERE organization_id=p_org AND fixed_asset_id=p_asset AND status IN ('posted','reversed');
  IF v_last_period_end IS NOT NULL AND p_period_start<>v_last_period_end+1 THEN
    RAISE EXCEPTION 'Les périodes doivent être continues : commence le lendemain de la dernière dotation comptabilisée';
  END IF;
  IF v_last_period_end IS NULL AND p_period_start>a.in_service_date THEN
    RAISE EXCEPTION 'La première période doit couvrir la date de mise en service';
  END IF;

  IF EXISTS (SELECT 1 FROM public.fixed_asset_impairments
    WHERE organization_id=p_org AND fixed_asset_id=p_asset
      AND event_date>p_period_start AND event_date<=p_period_end) THEN
    RAISE EXCEPTION 'Une dépréciation ou une reprise intervient dans cette période. Scinde la période à la date de l’événement.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_impairments
    WHERE organization_id=p_org AND fixed_asset_id=p_asset
      AND event_date>p_period_end) THEN
    RAISE EXCEPTION 'Un événement de dépréciation postérieur est déjà comptabilisé. Prépare les périodes antérieures avant cet événement.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_disposals
    WHERE organization_id=p_org AND fixed_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Immobilisation déjà sortie du registre';
  END IF;

  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_base := greatest(0,v_gross-coalesce(a.residual_value,0));
  v_life_end := (a.in_service_date + make_interval(months => a.useful_life_months))::date;
  v_opening := round(coalesce(a.accumulated_depreciation,0),2);
  v_opening_net := round(coalesce(a.net_book_value,v_gross-v_opening-coalesce(a.impairment_loss,0)),2);
  IF abs(v_opening_net-greatest(0,v_gross-v_opening-coalesce(a.impairment_loss,0)))>0.01 THEN
    RAISE EXCEPTION 'La VNC d’ouverture ne correspond pas au coût, aux amortissements et aux dépréciations du registre';
  END IF;
  v_remaining_units := greatest(0,a.useful_life_months-
    public.magnisa_fixed_asset_month_units(a.in_service_date,a.in_service_date,p_period_start,a.useful_life_months));
  v_period_units := public.magnisa_fixed_asset_month_units(a.in_service_date,p_period_start,p_period_end+1,a.useful_life_months);
  v_charge := public.magnisa_fixed_asset_period_charge(
    v_opening_net,coalesce(a.residual_value,0),a.in_service_date,a.useful_life_months,p_period_start,p_period_end);
  v_charge := least(v_charge,greatest(0,v_opening_net-coalesce(a.residual_value,0)));
  v_closing := round(v_opening+v_charge,2);
  v_closing_net := greatest(0,round(v_opening_net-v_charge,2));
  v_details := jsonb_build_object(
    'engine','magnisa_fixed_asset_period_charge',
    'method','straight_line_day_prorata_prospective',
    'gross_cost',v_gross,'residual_value',a.residual_value,
    'directly_attributable_cost',a.directly_attributable_cost,
    'opening_net_book_value',v_opening_net,
    'opening_accumulated_depreciation',v_opening,
    'opening_impairment_loss',coalesce(a.impairment_loss,0),
    'remaining_useful_life_units',v_remaining_units,
    'period_useful_life_units',v_period_units,
    'service_date',a.in_service_date,'useful_life_months',a.useful_life_months,
    'useful_life_end_exclusive',v_life_end,'period_start',p_period_start,
    'period_end',p_period_end,'calculated_at',now()
  );

  INSERT INTO public.fixed_asset_depreciation_entries(
    organization_id,fixed_asset_id,period_start,period_end,method,depreciable_base,
    opening_accumulated_depreciation,depreciation_charge,closing_accumulated_depreciation,
    closing_net_book_value,status,calculation_details,created_by
  ) VALUES (
    p_org,p_asset,p_period_start,p_period_end,'straight_line',v_base,
    v_opening,v_charge,v_closing,v_closing_net,'planned',v_details,auth.uid()
  )
  ON CONFLICT (organization_id,fixed_asset_id,period_start,period_end)
  DO UPDATE SET
    depreciable_base=excluded.depreciable_base,
    opening_accumulated_depreciation=excluded.opening_accumulated_depreciation,
    depreciation_charge=excluded.depreciation_charge,
    closing_accumulated_depreciation=excluded.closing_accumulated_depreciation,
    closing_net_book_value=excluded.closing_net_book_value,
    calculation_details=excluded.calculation_details,updated_at=now()
  WHERE public.fixed_asset_depreciation_entries.status='planned'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=p_asset
      AND period_start=p_period_start AND period_end=p_period_end;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_post_fixed_asset_depreciation(
  p_org uuid,p_depreciation_entry uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d public.fixed_asset_depreciation_entries%rowtype;
  a public.fixed_assets%rowtype;
  v_journal uuid;
  v_lines jsonb;
  v_reference text;
  v_opening_net numeric(18,2);
  v_opening_impairment numeric(18,2);
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO d FROM public.fixed_asset_depreciation_entries
  WHERE id=p_depreciation_entry AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan de dotation introuvable'; END IF;
  IF d.status='posted' THEN RETURN d.journal_entry_id; END IF;
  IF d.status<>'planned' THEN RAISE EXCEPTION 'Seul un plan en attente peut être comptabilisé'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,d.period_end);
  SELECT * INTO a FROM public.fixed_assets
  WHERE id=d.fixed_asset_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active','fully_depreciated') THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF a.pcg_accumulated_depreciation_account_code IS NULL OR a.pcg_depreciation_expense_account_code IS NULL THEN
    RAISE EXCEPTION 'Comptes PCG 28 et 68 non configurés sur la fiche';
  END IF;
  v_opening_net := nullif(d.calculation_details->>'opening_net_book_value','')::numeric;
  v_opening_impairment := coalesce(nullif(d.calculation_details->>'opening_impairment_loss','')::numeric,0);
  IF round(coalesce(a.accumulated_depreciation,0),2)<>round(d.opening_accumulated_depreciation,2)
     OR round(coalesce(a.net_book_value,0),2)<>round(coalesce(v_opening_net,-1),2)
     OR round(coalesce(a.impairment_loss,0),2)<>round(v_opening_impairment,2) THEN
    RAISE EXCEPTION 'Les soldes du registre ont changé depuis la préparation. Recalcule le plan avant comptabilisation.';
  END IF;
  IF d.depreciation_charge<=0 THEN
    UPDATE public.fixed_asset_depreciation_entries SET status='posted',updated_at=now()
    WHERE id=d.id;
    RETURN NULL;
  END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_depreciation_expense_account_code,'debit',d.depreciation_charge,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_accumulated_depreciation_account_code,'debit',0,'credit',d.depreciation_charge)
  );
  v_reference := 'DOT-IMM-'||left(d.id::text,12);
  v_journal := public.magnisa_post_journal(
    p_org,d.period_end,v_reference,'Dotation aux amortissements - '||a.name,
    'fixed_asset_depreciation',d.id,v_lines
  );
  UPDATE public.fixed_asset_depreciation_entries
  SET status='posted',journal_entry_id=v_journal,updated_at=now()
  WHERE id=d.id;
  UPDATE public.fixed_assets
  SET accumulated_depreciation=d.closing_accumulated_depreciation,
      net_book_value=d.closing_net_book_value,
      status=CASE WHEN d.depreciation_charge>0 AND d.closing_net_book_value<=coalesce(residual_value,0) THEN 'fully_depreciated' ELSE status END,
      updated_at=now()
  WHERE id=a.id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.depreciation.posted','fixed_asset_depreciation',d.id,
    jsonb_build_object('accumulated_depreciation',a.accumulated_depreciation,'net_book_value',a.net_book_value),
    jsonb_build_object('journal_entry_id',v_journal,'charge',d.depreciation_charge,
      'closing_accumulated_depreciation',d.closing_accumulated_depreciation,'closing_net_book_value',d.closing_net_book_value));
  RETURN v_journal;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_fixed_asset_month_units(date,date,date,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_fixed_asset_period_charge(numeric,numeric,date,integer,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_fixed_asset_month_units(date,date,date,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_fixed_asset_period_charge(numeric,numeric,date,integer,date,date) TO authenticated;
REVOKE ALL ON FUNCTION public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_post_fixed_asset_depreciation(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_post_fixed_asset_depreciation(uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.magnisa_fixed_asset_period_charge(numeric,numeric,date,integer,date,date) IS
  'Calcul prospectif de la dotation à partir de la VNC après dépréciation, répartie sur la durée d’utilisation restante. La valeur résiduelle est préservée.';
