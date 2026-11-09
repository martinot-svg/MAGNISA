-- MAGNISA: controlled fixed-asset accounting lifecycle.
-- Additive, organization-scoped and production-data preserving. No automatic execution against production.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS pcg_impairment_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_impairment_expense_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_impairment_reversal_income_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_disposal_receivable_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_disposal_expense_account_code text,
  ADD COLUMN IF NOT EXISTS pcg_disposal_income_account_code text,
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid,
  ADD COLUMN IF NOT EXISTS component_reference text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fixed_assets_parent_org_fk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_parent_org_fk
      FOREIGN KEY (parent_asset_id, organization_id)
      REFERENCES public.fixed_assets(id, organization_id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS fixed_assets_parent_idx ON public.fixed_assets(organization_id,parent_asset_id);

-- The catalogue is deliberately limited to accounts used by the lifecycle workflows.
-- Existing organization mappings and posted journal entries are not rewritten.
INSERT INTO public.pcg2005_accounts(code,label,kind) VALUES
 ('29','Dépréciations des immobilisations','asset'),
 ('462','Créances sur cessions d’immobilisations','asset'),
 ('675','Valeurs comptables des éléments d’actif cédés','expense'),
 ('775','Produits des cessions d’éléments d’actif','income'),
 ('6816','Dotations aux dépréciations des immobilisations','expense'),
 ('7816','Reprises sur dépréciations des immobilisations','income')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fixed_asset_impairments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impairment','reversal')),
  event_date date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  recoverable_amount numeric(18,2) NOT NULL CHECK (recoverable_amount >= 0),
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (fixed_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS fixed_asset_impairments_asset_date_idx
  ON public.fixed_asset_impairments(organization_id,fixed_asset_id,event_date);

CREATE TABLE IF NOT EXISTS public.fixed_asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  disposal_date date NOT NULL,
  proceeds numeric(18,2) NOT NULL DEFAULT 0 CHECK (proceeds >= 0),
  carrying_amount numeric(18,2) NOT NULL CHECK (carrying_amount >= 0),
  gain numeric(18,2) NOT NULL DEFAULT 0 CHECK (gain >= 0),
  loss numeric(18,2) NOT NULL DEFAULT 0 CHECK (loss >= 0),
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,fixed_asset_id),
  FOREIGN KEY (fixed_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT,
  CHECK (NOT (gain > 0 AND loss > 0))
);

CREATE TABLE IF NOT EXISTS public.fixed_asset_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  transfer_date date NOT NULL,
  old_location text,
  new_location text,
  old_custodian text,
  new_custodian text,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (fixed_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT
);

-- IFRS adjustments are an independent subledger. They never update PCG carrying values or GL.
CREATE TABLE IF NOT EXISTS public.fixed_asset_ifrs_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  adjustment_date date NOT NULL,
  standard_reference text NOT NULL DEFAULT 'IAS 16',
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('componentization','useful_life','residual_value','revaluation','impairment','derecognition','other')),
  statutory_carrying_amount numeric(18,2) NOT NULL CHECK (statutory_carrying_amount >= 0),
  ifrs_carrying_amount numeric(18,2) NOT NULL CHECK (ifrs_carrying_amount >= 0),
  adjustment_amount numeric(18,2) GENERATED ALWAYS AS (ifrs_carrying_amount-statutory_carrying_amount) STORED,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  supporting_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','reversed')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (fixed_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT,
  CHECK ((status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status<>'approved')
);
CREATE INDEX IF NOT EXISTS fixed_asset_ifrs_adjustments_asset_date_idx
  ON public.fixed_asset_ifrs_adjustments(organization_id,fixed_asset_id,adjustment_date,status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fixed_asset_impairments','fixed_asset_disposals','fixed_asset_transfers','fixed_asset_ifrs_adjustments']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,''accounting.view''))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_org_permission(organization_id,''accounting.manage''))',t||'_insert',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_org_permission(organization_id,''accounting.manage'')) WITH CHECK (public.has_org_permission(organization_id,''accounting.manage''))',t||'_update',t);
  END LOOP;
END $$;

-- Mirror the TypeScript straight-line calculation: day prorata within each service-month.
CREATE OR REPLACE FUNCTION public.magnisa_fixed_asset_cumulative_depreciation(
  p_base numeric,p_service_date date,p_useful_months integer,p_as_of_exclusive date
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  v_month integer;
  v_month_start date;
  v_month_end date;
  v_elapsed numeric := 0;
  v_days numeric;
BEGIN
  IF p_base < 0 OR p_useful_months <= 0 THEN RAISE EXCEPTION 'Base ou durée d’amortissement invalide'; END IF;
  IF p_as_of_exclusive <= p_service_date THEN RETURN 0; END IF;
  FOR v_month IN 0..(p_useful_months-1) LOOP
    v_month_start := (p_service_date + make_interval(months => v_month))::date;
    v_month_end := (p_service_date + make_interval(months => v_month+1))::date;
    IF p_as_of_exclusive >= v_month_end THEN
      v_elapsed := v_elapsed + 1;
    ELSIF p_as_of_exclusive > v_month_start THEN
      v_days := v_month_end-v_month_start;
      v_elapsed := v_elapsed + ((p_as_of_exclusive-v_month_start)::numeric/v_days);
      EXIT;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN round(p_base*least(p_useful_months,v_elapsed)/p_useful_months,2);
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
  v_closing numeric(18,2);
  v_charge numeric(18,2);
  v_days integer;
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
  IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=p_asset AND status='posted'
      AND daterange(period_start,period_end,'[]') && daterange(p_period_start,p_period_end,'[]')) THEN
    SELECT id INTO v_id FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=p_asset AND status='posted'
      AND period_start=p_period_start AND period_end=p_period_end;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    RAISE EXCEPTION 'La période chevauche une dotation déjà comptabilisée';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_disposals WHERE organization_id=p_org AND fixed_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Immobilisation déjà sortie du registre';
  END IF;
  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_base := greatest(0,v_gross-coalesce(a.residual_value,0));
  v_life_end := (a.in_service_date + make_interval(months => a.useful_life_months))::date;
  v_opening := coalesce(a.accumulated_depreciation,0);
  v_closing := public.magnisa_fixed_asset_cumulative_depreciation(v_base,a.in_service_date,a.useful_life_months,p_period_end+1);
  v_closing := least(v_base,greatest(v_opening,v_closing));
  v_charge := round(greatest(0,v_closing-v_opening),2);
  v_details := jsonb_build_object(
    'engine','magnisa_fixed_asset_cumulative_depreciation',
    'method','straight_line_day_prorata',
    'gross_cost',v_gross,'residual_value',a.residual_value,
    'directly_attributable_cost',a.directly_attributable_cost,
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
    v_opening,v_charge,v_closing,greatest(coalesce(a.residual_value,0),v_gross-v_closing),
    'planned',v_details,auth.uid()
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
  IF round(coalesce(a.accumulated_depreciation,0),2)<>round(d.opening_accumulated_depreciation,2) THEN
    RAISE EXCEPTION 'Le cumul du registre a changé depuis la préparation. Recalcule le plan avant comptabilisation.';
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
      status=CASE WHEN d.closing_net_book_value<=coalesce(residual_value,0) THEN 'fully_depreciated' ELSE status END,
      updated_at=now()
  WHERE id=a.id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.depreciation.posted','fixed_asset_depreciation',d.id,
    jsonb_build_object('accumulated_depreciation',a.accumulated_depreciation,'net_book_value',a.net_book_value),
    jsonb_build_object('journal_entry_id',v_journal,'charge',d.depreciation_charge,
      'closing_accumulated_depreciation',d.closing_accumulated_depreciation,'closing_net_book_value',d.closing_net_book_value));
  RETURN v_journal;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_record_fixed_asset_impairment(
  p_org uuid,p_asset uuid,p_date date,p_recoverable_amount numeric,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_amount numeric(18,2);
  v_event uuid;
  v_journal uuid;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  SELECT * INTO a FROM public.fixed_assets WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF p_recoverable_amount IS NULL OR p_recoverable_amount<0 OR p_recoverable_amount>=a.net_book_value THEN
    RAISE EXCEPTION 'La valeur recouvrable doit être inférieure à la valeur nette comptable actuelle';
  END IF;
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Une justification documentée est obligatoire'; END IF;
  IF a.pcg_impairment_account_code IS NULL OR a.pcg_impairment_expense_account_code IS NULL THEN
    RAISE EXCEPTION 'Comptes PCG 29 et 68 de dépréciation non configurés';
  END IF;
  v_amount := round(a.net_book_value-p_recoverable_amount,2);
  INSERT INTO public.fixed_asset_impairments(organization_id,fixed_asset_id,event_type,event_date,amount,recoverable_amount,reason,created_by)
  VALUES(p_org,p_asset,'impairment',p_date,v_amount,p_recoverable_amount,trim(p_reason),auth.uid())
  RETURNING id INTO v_event;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_expense_account_code,'debit',v_amount,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_account_code,'debit',0,'credit',v_amount)
  );
  v_journal := public.magnisa_post_journal(p_org,p_date,'DEP-IMM-'||left(v_event::text,12),
    'Dépréciation immobilisation - '||a.name,'fixed_asset_impairment',v_event,v_lines);
  UPDATE public.fixed_asset_impairments SET journal_entry_id=v_journal WHERE id=v_event;
  UPDATE public.fixed_assets SET impairment_loss=coalesce(impairment_loss,0)+v_amount,
    net_book_value=p_recoverable_amount,updated_at=now()
  WHERE id=p_asset AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.impairment.posted','fixed_asset_impairment',v_event,NULL,
    jsonb_build_object('amount',v_amount,'recoverable_amount',p_recoverable_amount,'journal_entry_id',v_journal));
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_reverse_fixed_asset_impairment(
  p_org uuid,p_impairment uuid,p_date date,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  i public.fixed_asset_impairments%rowtype;
  a public.fixed_assets%rowtype;
  v_event uuid;
  v_journal uuid;
  v_reversal numeric(18,2);
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  SELECT * INTO i FROM public.fixed_asset_impairments
  WHERE id=p_impairment AND organization_id=p_org AND event_type='impairment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dépréciation initiale introuvable'; END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_impairments WHERE organization_id=p_org AND event_type='reversal' AND reason LIKE '%'||p_impairment::text||'%') THEN
    RAISE EXCEPTION 'Cette dépréciation a déjà fait l’objet d’une reprise';
  END IF;
  SELECT * INTO a FROM public.fixed_assets WHERE id=i.fixed_asset_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF a.pcg_impairment_account_code IS NULL OR a.pcg_impairment_reversal_income_account_code IS NULL THEN
    RAISE EXCEPTION 'Comptes PCG de reprise non configurés';
  END IF;
  v_reversal := least(i.amount,coalesce(a.impairment_loss,0));
  IF v_reversal<=0 THEN RAISE EXCEPTION 'Aucune dépréciation à reprendre'; END IF;
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Une justification de reprise est obligatoire'; END IF;
  INSERT INTO public.fixed_asset_impairments(organization_id,fixed_asset_id,event_type,event_date,amount,recoverable_amount,reason,created_by)
  VALUES(p_org,i.fixed_asset_id,'reversal',p_date,v_reversal,
    least(a.acquisition_cost+coalesce(a.directly_attributable_cost,0)-coalesce(a.accumulated_depreciation,0),
      a.net_book_value+v_reversal),trim(p_reason)||' [reprise de '||p_impairment::text||']',auth.uid())
  RETURNING id INTO v_event;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_account_code,'debit',v_reversal,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_reversal_income_account_code,'debit',0,'credit',v_reversal)
  );
  v_journal := public.magnisa_post_journal(p_org,p_date,'REP-IMM-'||left(v_event::text,12),
    'Reprise dépréciation immobilisation - '||a.name,'fixed_asset_impairment_reversal',v_event,v_lines);
  UPDATE public.fixed_asset_impairments SET journal_entry_id=v_journal WHERE id=v_event;
  UPDATE public.fixed_assets SET impairment_loss=greatest(0,coalesce(impairment_loss,0)-v_reversal),
    net_book_value=least(a.acquisition_cost+coalesce(a.directly_attributable_cost,0)-coalesce(a.accumulated_depreciation,0),
      net_book_value+v_reversal),updated_at=now()
  WHERE id=a.id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.impairment.reversed','fixed_asset_impairment',v_event,NULL,
    jsonb_build_object('original_impairment_id',p_impairment,'amount',v_reversal,'journal_entry_id',v_journal));
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_dispose_fixed_asset(
  p_org uuid,p_asset uuid,p_date date,p_proceeds numeric,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_gross numeric(18,2);
  v_carrying numeric(18,2);
  v_gain numeric(18,2);
  v_loss numeric(18,2);
  v_event uuid;
  v_journal uuid;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_date);
  SELECT * INTO a FROM public.fixed_assets WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF p_proceeds IS NULL OR p_proceeds<0 OR length(trim(coalesce(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'Produit de cession ou motif invalide';
  END IF;
  IF a.pcg_asset_account_code IS NULL OR a.pcg_accumulated_depreciation_account_code IS NULL
     OR a.pcg_impairment_account_code IS NULL OR a.pcg_disposal_receivable_account_code IS NULL
     OR a.pcg_disposal_expense_account_code IS NULL OR a.pcg_disposal_income_account_code IS NULL THEN
    RAISE EXCEPTION 'Les comptes PCG 2, 28, 29, 462, 675 et 775 doivent être paramétrés';
  END IF;
  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_carrying := greatest(0,round(v_gross-coalesce(a.accumulated_depreciation,0)-coalesce(a.impairment_loss,0),2));
  IF coalesce(a.accumulated_depreciation,0)>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_accumulated_depreciation_account_code,'debit',a.accumulated_depreciation,'credit',0));
  END IF;
  IF coalesce(a.impairment_loss,0)>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_account_code,'debit',a.impairment_loss,'credit',0));
  END IF;
  IF p_proceeds>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_disposal_receivable_account_code,'debit',p_proceeds,'credit',0));
  END IF;
  v_gain := greatest(0,round(p_proceeds-v_carrying,2));
  v_loss := greatest(0,round(v_carrying-p_proceeds,2));
  IF v_loss>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_disposal_expense_account_code,'debit',v_loss,'credit',0));
  END IF;
  v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_asset_account_code,'debit',0,'credit',v_gross));
  IF v_gain>0 THEN
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_disposal_income_account_code,'debit',0,'credit',v_gain));
  END IF;
  INSERT INTO public.fixed_asset_disposals(organization_id,fixed_asset_id,disposal_date,proceeds,carrying_amount,gain,loss,reason,created_by)
  VALUES(p_org,p_asset,p_date,p_proceeds,v_carrying,v_gain,v_loss,trim(p_reason),auth.uid())
  RETURNING id INTO v_event;
  v_journal := public.magnisa_post_journal(p_org,p_date,'CESS-IMM-'||left(v_event::text,12),
    'Sortie immobilisation - '||a.name,'fixed_asset_disposal',v_event,v_lines);
  UPDATE public.fixed_asset_disposals SET journal_entry_id=v_journal WHERE id=v_event;
  UPDATE public.fixed_assets SET status='disposed',disposed_at=p_date,disposal_proceeds=p_proceeds,
    net_book_value=0,updated_at=now() WHERE id=p_asset AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.disposed','fixed_asset',p_asset,
    jsonb_build_object('status',a.status,'net_book_value',a.net_book_value),
    jsonb_build_object('disposal_id',v_event,'journal_entry_id',v_journal,'proceeds',p_proceeds,'gain',v_gain,'loss',v_loss));
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_transfer_fixed_asset(
  p_org uuid,p_asset uuid,p_date date,p_new_location text,p_new_custodian text,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_event uuid;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO a FROM public.fixed_assets WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF length(trim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'Motif du transfert obligatoire'; END IF;
  INSERT INTO public.fixed_asset_transfers(organization_id,fixed_asset_id,transfer_date,old_location,new_location,old_custodian,new_custodian,reason,created_by)
  VALUES(p_org,p_asset,p_date,a.location,nullif(trim(p_new_location),''),a.custodian,nullif(trim(p_new_custodian),''),trim(p_reason),auth.uid())
  RETURNING id INTO v_event;
  UPDATE public.fixed_assets SET location=nullif(trim(p_new_location),''),custodian=nullif(trim(p_new_custodian),''),updated_at=now()
  WHERE id=p_asset AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.transferred','fixed_asset',p_asset,
    jsonb_build_object('location',a.location,'custodian',a.custodian),
    jsonb_build_object('location',p_new_location,'custodian',p_new_custodian,'transfer_id',v_event));
  RETURN v_event;
END $$;

CREATE OR REPLACE FUNCTION public.magnisa_approve_fixed_asset_ifrs_adjustment(
  p_org uuid,p_adjustment uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.fixed_asset_ifrs_adjustments%rowtype;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO v_row FROM public.fixed_asset_ifrs_adjustments
  WHERE id=p_adjustment AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_row.status<>'draft' THEN RAISE EXCEPTION 'Ajustement IFRS absent ou déjà traité'; END IF;
  UPDATE public.fixed_asset_ifrs_adjustments SET status='approved',approved_by=auth.uid(),approved_at=now()
  WHERE id=p_adjustment AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.ifrs_adjustment.approved','fixed_asset_ifrs_adjustment',p_adjustment,
    jsonb_build_object('status','draft'),
    jsonb_build_object('status','approved','adjustment_amount',v_row.adjustment_amount,'standard',v_row.standard_reference));
  RETURN p_adjustment;
END $$;

CREATE OR REPLACE VIEW public.fixed_asset_register_reconciliation
WITH (security_invoker=true) AS
WITH register_balances AS (
  SELECT organization_id,pcg_asset_account_code AS account_code,
    sum(acquisition_cost+coalesce(directly_attributable_cost,0))::numeric(20,2) AS register_debit,
    0::numeric(20,2) AS register_credit
  FROM public.fixed_assets WHERE status<>'disposed' AND pcg_asset_account_code IS NOT NULL
  GROUP BY organization_id,pcg_asset_account_code
  UNION ALL
  SELECT organization_id,pcg_accumulated_depreciation_account_code,
    0::numeric(20,2),sum(coalesce(accumulated_depreciation,0))::numeric(20,2)
  FROM public.fixed_assets WHERE status<>'disposed' AND pcg_accumulated_depreciation_account_code IS NOT NULL
  GROUP BY organization_id,pcg_accumulated_depreciation_account_code
  UNION ALL
  SELECT organization_id,pcg_impairment_account_code,
    0::numeric(20,2),sum(coalesce(impairment_loss,0))::numeric(20,2)
  FROM public.fixed_assets WHERE status<>'disposed' AND pcg_impairment_account_code IS NOT NULL
  GROUP BY organization_id,pcg_impairment_account_code
), register_totals AS (
  SELECT organization_id,account_code,sum(register_debit) AS register_debit,sum(register_credit) AS register_credit
  FROM register_balances GROUP BY organization_id,account_code
), ledger_totals AS (
  SELECT organization_id,pcg_code AS account_code,sum(debit)::numeric(20,2) AS ledger_debit,
    sum(credit)::numeric(20,2) AS ledger_credit
  FROM public.pcg2005_journal_lines
  WHERE status='posted' AND pcg_code ~ '^(2|28|29)'
  GROUP BY organization_id,pcg_code
)
SELECT coalesce(r.organization_id,l.organization_id) AS organization_id,
  coalesce(r.account_code,l.account_code) AS account_code,
  coalesce(r.register_debit,0)::numeric(20,2) AS register_debit,
  coalesce(r.register_credit,0)::numeric(20,2) AS register_credit,
  coalesce(l.ledger_debit,0)::numeric(20,2) AS ledger_debit,
  coalesce(l.ledger_credit,0)::numeric(20,2) AS ledger_credit,
  round(coalesce(r.register_debit,0)-coalesce(l.ledger_debit,0),2) AS debit_difference,
  round(coalesce(r.register_credit,0)-coalesce(l.ledger_credit,0),2) AS credit_difference,
  CASE WHEN round(coalesce(r.register_debit,0)-coalesce(l.ledger_debit,0),2)=0
      AND round(coalesce(r.register_credit,0)-coalesce(l.ledger_credit,0),2)=0
    THEN 'reconciled' ELSE 'difference' END AS reconciliation_status
FROM register_totals r FULL JOIN ledger_totals l
  ON l.organization_id=r.organization_id AND l.account_code=r.account_code;

REVOKE ALL ON public.fixed_asset_register_reconciliation FROM anon;
GRANT SELECT ON public.fixed_asset_register_reconciliation TO authenticated;

REVOKE ALL ON FUNCTION public.magnisa_fixed_asset_cumulative_depreciation(numeric,date,integer,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_post_fixed_asset_depreciation(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_record_fixed_asset_impairment(uuid,uuid,date,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_reverse_fixed_asset_impairment(uuid,uuid,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_transfer_fixed_asset(uuid,uuid,date,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_approve_fixed_asset_ifrs_adjustment(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_plan_fixed_asset_depreciation(uuid,uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_post_fixed_asset_depreciation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_record_fixed_asset_impairment(uuid,uuid,date,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_reverse_fixed_asset_impairment(uuid,uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_transfer_fixed_asset(uuid,uuid,date,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.magnisa_approve_fixed_asset_ifrs_adjustment(uuid,uuid) TO authenticated;

COMMENT ON TABLE public.fixed_asset_ifrs_adjustments IS
  'Separate IFRS adjustment register. Approval records a bridge adjustment only; it never changes statutory PCG values or posts to the statutory general ledger.';
COMMENT ON VIEW public.fixed_asset_register_reconciliation IS
  'Compares non-disposed fixed-asset register balances with posted PCG ledger balances for accounts 2, 28 and 29.';
