-- Component accounting uses child rows in the existing fixed_assets register.
-- The parent becomes a zero-value grouping record; component rows carry the PCG balances.
CREATE TABLE IF NOT EXISTS public.fixed_asset_componentizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_asset_id uuid NOT NULL,
  component_count integer NOT NULL CHECK (component_count BETWEEN 2 AND 20),
  gross_cost_reclassified numeric(18,2) NOT NULL CHECK (gross_cost_reclassified > 0),
  accumulated_depreciation_reclassified numeric(18,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation_reclassified >= 0),
  impairment_reclassified numeric(18,2) NOT NULL DEFAULT 0 CHECK (impairment_reclassified >= 0),
  event_date date NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,parent_asset_id),
  FOREIGN KEY (parent_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT
);
ALTER TABLE public.fixed_asset_componentizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixed_asset_componentizations FROM PUBLIC,anon;
GRANT SELECT ON public.fixed_asset_componentizations TO authenticated;
DROP POLICY IF EXISTS fixed_asset_componentizations_select ON public.fixed_asset_componentizations;
CREATE POLICY fixed_asset_componentizations_select ON public.fixed_asset_componentizations
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'accounting.view'));

CREATE OR REPLACE FUNCTION public.magnisa_componentize_fixed_asset(
  p_org uuid,p_parent_asset uuid,p_event_date date,p_components jsonb,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  p public.fixed_assets%rowtype;
  c jsonb;
  v_event_id uuid;
  v_journal uuid;
  v_lines jsonb := '[]'::jsonb;
  v_gross numeric(18,2);
  v_accum numeric(18,2);
  v_impair numeric(18,2);
  v_residual numeric(18,2);
  v_cost numeric(18,2);
  v_direct numeric(18,2);
  v_component_accum numeric(18,2);
  v_component_impair numeric(18,2);
  v_component_residual numeric(18,2);
  v_life integer;
  v_method text;
  v_service_date date;
  v_code text;
  v_name text;
  v_asset_account text;
  v_accum_account text;
  v_expense_account text;
  v_impairment_account text;
  v_impairment_expense_account text;
  v_impairment_reversal_account text;
  v_disposal_receivable_account text;
  v_disposal_expense_account text;
  v_disposal_income_account text;
  v_count integer := 0;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_event_date);

  IF jsonb_typeof(p_components) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_components)<2 OR jsonb_array_length(p_components)>20 THEN
    RAISE EXCEPTION 'Une ventilation par composants doit contenir entre 2 et 20 lignes';
  END IF;
  IF length(trim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'Justification de la décomposition obligatoire';
  END IF;

  SELECT * INTO p FROM public.fixed_assets
  WHERE id=p_parent_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR p.status NOT IN ('active','fully_depreciated') THEN
    RAISE EXCEPTION 'Immobilisation mère inactive ou introuvable';
  END IF;
  IF p.component_reference='componentized_parent' OR EXISTS (
    SELECT 1 FROM public.fixed_assets WHERE organization_id=p_org AND parent_asset_id=p_parent_asset
  ) THEN
    RAISE EXCEPTION 'Cette immobilisation est déjà ventilée en composants';
  END IF;
  IF p.acquisition_journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'L’acquisition de l’immobilisation mère doit être comptabilisée avant la ventilation';
  END IF;
  IF p.pcg_asset_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte PCG d’actif de l’immobilisation mère absent';
  END IF;

  v_gross := round(p.acquisition_cost+coalesce(p.directly_attributable_cost,0),2);
  v_accum := round(coalesce(p.accumulated_depreciation,0),2);
  v_impair := round(coalesce(p.impairment_loss,0),2);
  v_residual := round(coalesce(p.residual_value,0),2);
  IF v_gross<=0 OR v_accum+v_impair>v_gross THEN
    RAISE EXCEPTION 'Valeurs comptables de l’immobilisation mère incohérentes';
  END IF;
  IF v_accum>0 AND p.pcg_accumulated_depreciation_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte PCG 28 de l’immobilisation mère absent';
  END IF;
  IF v_impair>0 AND p.pcg_impairment_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte PCG 29 de l’immobilisation mère absent';
  END IF;

  v_lines := jsonb_build_array(jsonb_build_object(
    'account_kind','pcg','pcg_code',p.pcg_asset_account_code,'debit',0,'credit',v_gross
  ));

  FOR c IN SELECT value FROM jsonb_array_elements(p_components) LOOP
    v_count := v_count+1;
    v_code := trim(coalesce(c->>'asset_code',''));
    v_name := trim(coalesce(c->>'name',''));
    v_cost := round(coalesce((c->>'acquisition_cost')::numeric,0),2);
    v_direct := round(coalesce((c->>'directly_attributable_cost')::numeric,0),2);
    v_component_residual := round(coalesce((c->>'residual_value')::numeric,0),2);
    v_component_accum := round(coalesce((c->>'accumulated_depreciation')::numeric,0),2);
    v_component_impair := round(coalesce((c->>'impairment_loss')::numeric,0),2);
    v_life := nullif(c->>'useful_life_months','')::integer;
    v_method := coalesce(nullif(c->>'depreciation_method',''),'straight_line');
    v_service_date := coalesce(nullif(c->>'in_service_date','')::date,p.in_service_date);
    v_asset_account := trim(coalesce(c->>'pcg_asset_account_code',''));
    v_accum_account := nullif(trim(coalesce(c->>'pcg_accumulated_depreciation_account_code','')),'');
    v_expense_account := nullif(trim(coalesce(c->>'pcg_depreciation_expense_account_code','')),'');
    v_impairment_account := coalesce(nullif(trim(coalesce(c->>'pcg_impairment_account_code','')),''),p.pcg_impairment_account_code);
    v_impairment_expense_account := coalesce(nullif(trim(coalesce(c->>'pcg_impairment_expense_account_code','')),''),p.pcg_impairment_expense_account_code);
    v_impairment_reversal_account := coalesce(nullif(trim(coalesce(c->>'pcg_impairment_reversal_income_account_code','')),''),p.pcg_impairment_reversal_income_account_code);
    v_disposal_receivable_account := coalesce(nullif(trim(coalesce(c->>'pcg_disposal_receivable_account_code','')),''),p.pcg_disposal_receivable_account_code);
    v_disposal_expense_account := coalesce(nullif(trim(coalesce(c->>'pcg_disposal_expense_account_code','')),''),p.pcg_disposal_expense_account_code);
    v_disposal_income_account := coalesce(nullif(trim(coalesce(c->>'pcg_disposal_income_account_code','')),''),p.pcg_disposal_income_account_code);

    IF v_code='' OR v_name='' OR v_cost<=0 OR v_direct<0 OR v_component_residual<0
      OR v_component_accum<0 OR v_component_impair<0
      OR v_component_accum+v_component_impair>v_cost+v_direct
      OR v_component_residual>v_cost+v_direct
      OR v_method NOT IN ('straight_line','none')
      OR v_service_date<p.acquisition_date THEN
      RAISE EXCEPTION 'Composant % : données de coût, date, méthode ou valeur résiduelle invalides',v_count;
    END IF;
    IF v_method='straight_line' AND (coalesce(v_life,0)<=0 OR v_accum_account IS NULL OR v_expense_account IS NULL) THEN
      RAISE EXCEPTION 'Composant % : durée et comptes PCG 28/68 obligatoires',v_count;
    END IF;
    IF (v_asset_account !~ '^(20|21|22|23|26|27)[0-9]{0,4}
      OR v_impairment_account IS NULL OR v_impairment_account !~ '^29[0-9]{0,4}$'
      OR v_impairment_expense_account IS NULL OR v_impairment_expense_account !~ '^68[0-9]{0,4}$'
      OR v_impairment_reversal_account IS NULL OR v_impairment_reversal_account !~ '^78[0-9]{0,4}$'
      OR v_disposal_receivable_account IS NULL OR v_disposal_receivable_account !~ '^46[0-9]{0,4}$'
      OR v_disposal_expense_account IS NULL OR v_disposal_expense_account !~ '^65[0-9]{0,4}$'
      OR v_disposal_income_account IS NULL OR v_disposal_income_account !~ '^75[0-9]{0,4}$' THEN
      RAISE EXCEPTION 'Composant % : mapping PCG de l’actif, des dépréciations ou de la sortie invalide',v_count;
    END IF;
    IF v_component_accum>0 AND (v_accum_account IS NULL OR v_accum_account !~ '^28[0-9]{0,4}$') THEN
      RAISE EXCEPTION 'Composant % : compte 28 invalide',v_count;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_asset_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_expense_account AND kind='expense')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_reversal_account AND kind='income')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_receivable_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_expense_account AND kind='expense')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_income_account AND kind='income') THEN
      RAISE EXCEPTION 'Composant % : un compte PCG de suivi est absent ou de type incorrect',v_count;
    END IF;
    IF v_method='straight_line' AND (
      NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_accum_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_expense_account AND kind='expense')
    ) THEN
      RAISE EXCEPTION 'Composant % : comptes d’amortissement absents du PCG',v_count;
    END IF;
    IF v_component_accum>0 AND NOT EXISTS (
      SELECT 1 FROM public.pcg2005_accounts WHERE code=v_accum_account AND kind='asset'
    ) THEN
      RAISE EXCEPTION 'Composant % : compte d’amortissements cumulés absent du PCG',v_count;
    END IF;

    INSERT INTO public.fixed_assets(
      organization_id,asset_code,name,category,acquisition_date,in_service_date,
      acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,
      depreciation_method,pcg_asset_account_code,pcg_accumulated_depreciation_account_code,
      pcg_depreciation_expense_account_code,pcg_impairment_account_code,
      pcg_impairment_expense_account_code,pcg_impairment_reversal_income_account_code,
      pcg_disposal_receivable_account_code,pcg_disposal_expense_account_code,pcg_disposal_income_account_code,
      accumulated_depreciation,impairment_loss,net_book_value,status,parent_asset_id,
      component_reference,legacy_accounting_origin,supplier_name,invoice_reference,
      created_at,updated_at
    ) VALUES (
      p_org,v_code,v_name,coalesce(nullif(c->>'category',''),p.category),p.acquisition_date,v_service_date,
      v_cost,v_direct,v_component_residual,v_life,v_method,v_asset_account,v_accum_account,
      v_expense_account,v_impairment_account,v_impairment_expense_account,v_impairment_reversal_account,
      v_disposal_receivable_account,v_disposal_expense_account,v_disposal_income_account,
      v_component_accum,v_component_impair,
      round(v_cost+v_direct-v_component_accum-v_component_impair,2),'active',p_parent_asset,
      v_code,true,p.supplier_name,p.invoice_reference,now(),now()
    );

    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_asset_account,'debit',round(v_cost+v_direct,2),'credit',0
    ));
    IF v_component_accum>0 THEN
      v_lines := v_lines||jsonb_build_array(jsonb_build_object(
        'account_kind','pcg','pcg_code',v_accum_account,'debit',0,'credit',v_component_accum
      ));
    END IF;
    IF v_component_impair>0 THEN
      v_lines := v_lines||jsonb_build_array(jsonb_build_object(
        'account_kind','pcg','pcg_code',v_impairment_account,'debit',0,'credit',v_component_impair
      ));
    END IF;
  END LOOP;

  IF round((SELECT coalesce(sum((x->>'acquisition_cost')::numeric+coalesce((x->>'directly_attributable_cost')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_gross THEN
    RAISE EXCEPTION 'La somme des coûts des composants doit être égale au coût brut de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'accumulated_depreciation')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_accum THEN
    RAISE EXCEPTION 'La somme des amortissements composants doit être égale au cumul de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'impairment_loss')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_impair THEN
    RAISE EXCEPTION 'La somme des dépréciations composants doit être égale au cumul de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'residual_value')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_residual THEN
    RAISE EXCEPTION 'La somme des valeurs résiduelles composants doit être égale à celle de l’immobilisation mère';
  END IF;

  IF v_accum>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',p.pcg_accumulated_depreciation_account_code,'debit',v_accum,'credit',0
    ));
  END IF;
  IF v_impair>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',p.pcg_impairment_account_code,'debit',v_impair,'credit',0
    ));
  END IF;

  v_journal := public.magnisa_post_journal(p_org,p_event_date,'COMP-IMM-'||left(p.id::text,12),
    'Ventilation par composants - '||p.name,'fixed_asset_componentization',p.id,v_lines);
  INSERT INTO public.fixed_asset_componentizations(
    organization_id,parent_asset_id,component_count,gross_cost_reclassified,
    accumulated_depreciation_reclassified,impairment_reclassified,event_date,reason,journal_entry_id,created_by
  ) VALUES(p_org,p_parent_asset,v_count,v_gross,v_accum,v_impair,p_event_date,trim(p_reason),v_journal,auth.uid())
  RETURNING id INTO v_event_id;

  UPDATE public.fixed_assets SET acquisition_cost=0,directly_attributable_cost=0,
    residual_value=0,useful_life_months=NULL,depreciation_method='none',
    accumulated_depreciation=0,impairment_loss=0,net_book_value=0,
    component_reference='componentized_parent',updated_at=now()
  WHERE id=p_parent_asset AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'fixed_asset.componentized','fixed_asset',p_parent_asset,
    jsonb_build_object('gross_cost',v_gross,'accumulated_depreciation',v_accum,'impairment_loss',v_impair),
    jsonb_build_object('componentization_id',v_event_id,'journal_entry_id',v_journal,'component_count',v_count));
  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_componentize_fixed_asset(uuid,uuid,date,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_componentize_fixed_asset(uuid,uuid,date,jsonb,text) TO authenticated;
 OR v_asset_account ~ '^229')
      OR v_impairment_account IS NULL OR v_impairment_account !~ '^29[0-9]{0,4}$'
      OR v_impairment_expense_account IS NULL OR v_impairment_expense_account !~ '^68[0-9]{0,4}$'
      OR v_impairment_reversal_account IS NULL OR v_impairment_reversal_account !~ '^78[0-9]{0,4}$'
      OR v_disposal_receivable_account IS NULL OR v_disposal_receivable_account !~ '^46[0-9]{0,4}$'
      OR v_disposal_expense_account IS NULL OR v_disposal_expense_account !~ '^65[0-9]{0,4}$'
      OR v_disposal_income_account IS NULL OR v_disposal_income_account !~ '^75[0-9]{0,4}$' THEN
      RAISE EXCEPTION 'Composant % : mapping PCG de l’actif, des dépréciations ou de la sortie invalide',v_count;
    END IF;
    IF v_component_accum>0 AND (v_accum_account IS NULL OR v_accum_account !~ '^28[0-9]{0,4}$') THEN
      RAISE EXCEPTION 'Composant % : compte 28 invalide',v_count;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_asset_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_expense_account AND kind='expense')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_impairment_reversal_account AND kind='income')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_receivable_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_expense_account AND kind='expense')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_disposal_income_account AND kind='income') THEN
      RAISE EXCEPTION 'Composant % : un compte PCG de suivi est absent ou de type incorrect',v_count;
    END IF;
    IF v_method='straight_line' AND (
      NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_accum_account AND kind='asset')
      OR NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code=v_expense_account AND kind='expense')
    ) THEN
      RAISE EXCEPTION 'Composant % : comptes d’amortissement absents du PCG',v_count;
    END IF;
    IF v_component_accum>0 AND NOT EXISTS (
      SELECT 1 FROM public.pcg2005_accounts WHERE code=v_accum_account AND kind='asset'
    ) THEN
      RAISE EXCEPTION 'Composant % : compte d’amortissements cumulés absent du PCG',v_count;
    END IF;

    INSERT INTO public.fixed_assets(
      organization_id,asset_code,name,category,acquisition_date,in_service_date,
      acquisition_cost,directly_attributable_cost,residual_value,useful_life_months,
      depreciation_method,pcg_asset_account_code,pcg_accumulated_depreciation_account_code,
      pcg_depreciation_expense_account_code,pcg_impairment_account_code,
      pcg_impairment_expense_account_code,pcg_impairment_reversal_income_account_code,
      pcg_disposal_receivable_account_code,pcg_disposal_expense_account_code,pcg_disposal_income_account_code,
      accumulated_depreciation,impairment_loss,net_book_value,status,parent_asset_id,
      component_reference,legacy_accounting_origin,supplier_name,invoice_reference,
      created_at,updated_at
    ) VALUES (
      p_org,v_code,v_name,coalesce(nullif(c->>'category',''),p.category),p.acquisition_date,v_service_date,
      v_cost,v_direct,v_component_residual,v_life,v_method,v_asset_account,v_accum_account,
      v_expense_account,v_impairment_account,v_impairment_expense_account,v_impairment_reversal_account,
      v_disposal_receivable_account,v_disposal_expense_account,v_disposal_income_account,
      v_component_accum,v_component_impair,
      round(v_cost+v_direct-v_component_accum-v_component_impair,2),'active',p_parent_asset,
      v_code,true,p.supplier_name,p.invoice_reference,now(),now()
    );

    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',v_asset_account,'debit',round(v_cost+v_direct,2),'credit',0
    ));
    IF v_component_accum>0 THEN
      v_lines := v_lines||jsonb_build_array(jsonb_build_object(
        'account_kind','pcg','pcg_code',v_accum_account,'debit',0,'credit',v_component_accum
      ));
    END IF;
    IF v_component_impair>0 THEN
      v_lines := v_lines||jsonb_build_array(jsonb_build_object(
        'account_kind','pcg','pcg_code',v_impairment_account,'debit',0,'credit',v_component_impair
      ));
    END IF;
  END LOOP;

  IF round((SELECT coalesce(sum((x->>'acquisition_cost')::numeric+coalesce((x->>'directly_attributable_cost')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_gross THEN
    RAISE EXCEPTION 'La somme des coûts des composants doit être égale au coût brut de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'accumulated_depreciation')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_accum THEN
    RAISE EXCEPTION 'La somme des amortissements composants doit être égale au cumul de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'impairment_loss')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_impair THEN
    RAISE EXCEPTION 'La somme des dépréciations composants doit être égale au cumul de l’immobilisation mère';
  END IF;
  IF round((SELECT coalesce(sum(coalesce((x->>'residual_value')::numeric,0)),0)
    FROM jsonb_array_elements(p_components) x),2)<>v_residual THEN
    RAISE EXCEPTION 'La somme des valeurs résiduelles composants doit être égale à celle de l’immobilisation mère';
  END IF;

  IF v_accum>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',p.pcg_accumulated_depreciation_account_code,'debit',v_accum,'credit',0
    ));
  END IF;
  IF v_impair>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object(
      'account_kind','pcg','pcg_code',p.pcg_impairment_account_code,'debit',v_impair,'credit',0
    ));
  END IF;

  v_journal := public.magnisa_post_journal(p_org,p_event_date,'COMP-IMM-'||left(p.id::text,12),
    'Ventilation par composants - '||p.name,'fixed_asset_componentization',p.id,v_lines);
  INSERT INTO public.fixed_asset_componentizations(
    organization_id,parent_asset_id,component_count,gross_cost_reclassified,
    accumulated_depreciation_reclassified,impairment_reclassified,event_date,reason,journal_entry_id,created_by
  ) VALUES(p_org,p_parent_asset,v_count,v_gross,v_accum,v_impair,p_event_date,trim(p_reason),v_journal,auth.uid())
  RETURNING id INTO v_event_id;

  UPDATE public.fixed_assets SET acquisition_cost=0,directly_attributable_cost=0,
    residual_value=0,useful_life_months=NULL,depreciation_method='none',
    accumulated_depreciation=0,impairment_loss=0,net_book_value=0,
    component_reference='componentized_parent',updated_at=now()
  WHERE id=p_parent_asset AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'fixed_asset.componentized','fixed_asset',p_parent_asset,
    jsonb_build_object('gross_cost',v_gross,'accumulated_depreciation',v_accum,'impairment_loss',v_impair),
    jsonb_build_object('componentization_id',v_event_id,'journal_entry_id',v_journal,'component_count',v_count));
  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_componentize_fixed_asset(uuid,uuid,date,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_componentize_fixed_asset(uuid,uuid,date,jsonb,text) TO authenticated;
