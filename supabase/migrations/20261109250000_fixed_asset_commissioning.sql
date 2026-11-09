-- Controlled commissioning of work-in-progress assets (PCG class 23).
-- The reclassification is a balanced journal and preserves any accumulated impairment.
CREATE TABLE IF NOT EXISTS public.fixed_asset_commissionings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid NOT NULL,
  event_date date NOT NULL,
  old_asset_account_code text NOT NULL,
  new_asset_account_code text NOT NULL,
  old_impairment_account_code text,
  new_impairment_account_code text NOT NULL,
  gross_cost_reclassified numeric(18,2) NOT NULL CHECK (gross_cost_reclassified > 0),
  impairment_reclassified numeric(18,2) NOT NULL DEFAULT 0 CHECK (impairment_reclassified >= 0),
  depreciation_method text NOT NULL CHECK (depreciation_method IN ('straight_line','none')),
  useful_life_months integer,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,fixed_asset_id),
  FOREIGN KEY (fixed_asset_id,organization_id)
    REFERENCES public.fixed_assets(id,organization_id) ON DELETE RESTRICT,
  CHECK (
    (depreciation_method='straight_line' AND useful_life_months>0)
    OR (depreciation_method='none' AND useful_life_months IS NULL)
  )
);
ALTER TABLE public.fixed_asset_commissionings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixed_asset_commissionings FROM PUBLIC,anon;
GRANT SELECT ON public.fixed_asset_commissionings TO authenticated;
DROP POLICY IF EXISTS fixed_asset_commissionings_select ON public.fixed_asset_commissionings;
CREATE POLICY fixed_asset_commissionings_select ON public.fixed_asset_commissionings
  FOR SELECT TO authenticated USING (public.has_org_permission(organization_id,'accounting.view'));

CREATE OR REPLACE FUNCTION public.magnisa_commission_fixed_asset(
  p_org uuid,
  p_asset uuid,
  p_event_date date,
  p_new_asset_account_code text,
  p_depreciation_method text,
  p_useful_life_months integer,
  p_accumulated_depreciation_account_code text,
  p_depreciation_expense_account_code text,
  p_impairment_account_code text,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_journal uuid;
  v_gross numeric(18,2);
  v_impairment numeric(18,2);
  v_kind text;
  v_expected_impairment_prefix text;
  v_expected_accumulated_prefix text;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF p_event_date IS NULL OR length(trim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'Date et justification de mise en service obligatoires';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_event_date);

  SELECT * INTO a FROM public.fixed_assets
  WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'active' OR a.pcg_asset_account_code NOT LIKE '23%' THEN
    RAISE EXCEPTION 'Seule une immobilisation en cours de classe 23 peut être mise en service';
  END IF;
  IF a.in_service_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cette immobilisation possède déjà une date de mise en service';
  END IF;
  IF a.acquisition_journal_entry_id IS NULL AND NOT a.legacy_accounting_origin THEN
    RAISE EXCEPTION 'Comptabilise ou rapproche d’abord l’acquisition de cette immobilisation';
  END IF;
  IF a.legacy_accounting_origin AND a.acquisition_journal_entry_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.fixed_asset_register_reconciliation r
       WHERE r.organization_id=p_org AND r.account_code=a.pcg_asset_account_code
         AND r.reconciliation_status='reconciled'
     ) THEN
    RAISE EXCEPTION 'Le solde historique du compte 23 doit être rapproché du grand livre avant la mise en service';
  END IF;
  IF p_event_date<a.acquisition_date THEN
    RAISE EXCEPTION 'La mise en service ne peut pas précéder l’acquisition';
  END IF;
  IF coalesce(a.accumulated_depreciation,0)<>0 THEN
    RAISE EXCEPTION 'Une immobilisation en cours ne doit pas porter d’amortissement cumulé avant sa mise en service';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Un historique d’amortissement existe déjà pour cette immobilisation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_disposals
    WHERE organization_id=p_org AND fixed_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Une immobilisation sortie ne peut pas être mise en service';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_componentizations
    WHERE organization_id=p_org AND parent_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Une immobilisation déjà ventilée ne peut pas être mise en service comme fiche mère';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_impairments
    WHERE organization_id=p_org AND fixed_asset_id=p_asset AND event_date>p_event_date) THEN
    RAISE EXCEPTION 'Traite les événements de dépréciation postérieurs après la mise en service';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_commissionings
    WHERE organization_id=p_org AND fixed_asset_id=p_asset) THEN
    RAISE EXCEPTION 'Cette immobilisation a déjà été mise en service';
  END IF;

  IF p_new_asset_account_code IS NULL
     OR p_new_asset_account_code !~ '^(20|21|22[0-8])[0-9]{0,4}$' THEN
    RAISE EXCEPTION 'Le nouveau compte doit être un compte d’immobilisation en service des classes 20, 21 ou 22';
  END IF;
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=p_new_asset_account_code;
  IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Le nouveau compte PCG doit être classé à l’actif'; END IF;

  v_expected_impairment_prefix := CASE
    WHEN p_new_asset_account_code LIKE '20%' THEN '290'
    WHEN p_new_asset_account_code LIKE '21%' THEN '291'
    WHEN p_new_asset_account_code LIKE '22%' THEN '292'
  END;
  IF p_impairment_account_code IS NULL
     OR p_impairment_account_code NOT LIKE v_expected_impairment_prefix||'%' THEN
    RAISE EXCEPTION 'Le compte 29 doit correspondre à la famille du nouvel actif';
  END IF;
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=p_impairment_account_code;
  IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Compte de dépréciation PCG invalide'; END IF;

  IF p_depreciation_method='straight_line' THEN
    IF p_new_asset_account_code LIKE '211%' THEN
      RAISE EXCEPTION 'Les terrains 211 ne sont pas amortis par défaut';
    END IF;
    IF coalesce(p_useful_life_months,0)<=0 OR p_depreciation_expense_account_code !~ '^681[0-9]{0,4}$' THEN
      RAISE EXCEPTION 'Durée d’utilisation et compte 681 obligatoires pour un actif amortissable';
    END IF;
    v_expected_accumulated_prefix := CASE
      WHEN p_new_asset_account_code LIKE '20%' THEN '280'
      WHEN p_new_asset_account_code LIKE '21%' THEN '281'
      WHEN p_new_asset_account_code LIKE '22%' THEN '282'
    END;
    IF p_accumulated_depreciation_account_code IS NULL
       OR p_accumulated_depreciation_account_code NOT LIKE v_expected_accumulated_prefix||'%' THEN
      RAISE EXCEPTION 'Le compte 28 doit correspondre à la famille du nouvel actif';
    END IF;
    SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=p_accumulated_depreciation_account_code;
    IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Compte 28 invalide'; END IF;
    SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=p_depreciation_expense_account_code;
    IF v_kind IS DISTINCT FROM 'expense' THEN RAISE EXCEPTION 'Compte 681 invalide'; END IF;
  ELSIF p_depreciation_method='none' THEN
    IF p_useful_life_months IS NOT NULL OR p_accumulated_depreciation_account_code IS NOT NULL
       OR p_depreciation_expense_account_code IS NOT NULL THEN
      RAISE EXCEPTION 'Une immobilisation non amortissable ne doit pas porter de durée ni de comptes 28/68';
    END IF;
  ELSE
    RAISE EXCEPTION 'Méthode d’amortissement non prise en charge';
  END IF;

  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_impairment := round(coalesce(a.impairment_loss,0),2);
  IF v_gross<=0 OR round(coalesce(a.net_book_value,0),2)<>round(greatest(0,v_gross-v_impairment),2) THEN
    RAISE EXCEPTION 'Le coût brut, la dépréciation et la VNC doivent être rapprochés avant la mise en service';
  END IF;
  IF v_impairment>0 AND (a.pcg_impairment_account_code IS NULL OR a.pcg_impairment_account_code !~ '^293[0-9]{0,4}$') THEN
    RAISE EXCEPTION 'Le compte de dépréciation du compte 23 doit être de la famille 293';
  END IF;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',p_new_asset_account_code,'debit',v_gross,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_asset_account_code,'debit',0,'credit',v_gross)
  );
  IF v_impairment>0 AND a.pcg_impairment_account_code<>p_impairment_account_code THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_account_code,'debit',v_impairment,'credit',0),
      jsonb_build_object('account_kind','pcg','pcg_code',p_impairment_account_code,'debit',0,'credit',v_impairment)
    );
  END IF;

  v_journal := public.magnisa_post_journal(
    p_org,p_event_date,'MIS-IMM-'||left(v_event_id::text,12),
    'Mise en service immobilisation - '||a.name,
    'fixed_asset_commissioning',v_event_id,v_lines
  );

  INSERT INTO public.fixed_asset_commissionings(
    id,organization_id,fixed_asset_id,event_date,old_asset_account_code,new_asset_account_code,
    old_impairment_account_code,new_impairment_account_code,gross_cost_reclassified,
    impairment_reclassified,depreciation_method,useful_life_months,reason,journal_entry_id,created_by
  ) VALUES (
    v_event_id,p_org,p_asset,p_event_date,a.pcg_asset_account_code,p_new_asset_account_code,
    a.pcg_impairment_account_code,p_impairment_account_code,v_gross,v_impairment,
    p_depreciation_method,p_useful_life_months,trim(p_reason),v_journal,auth.uid()
  );

  UPDATE public.fixed_assets SET
    pcg_asset_account_code=p_new_asset_account_code,
    in_service_date=p_event_date,
    depreciation_method=p_depreciation_method,
    useful_life_months=p_useful_life_months,
    pcg_accumulated_depreciation_account_code=p_accumulated_depreciation_account_code,
    pcg_depreciation_expense_account_code=p_depreciation_expense_account_code,
    pcg_impairment_account_code=p_impairment_account_code,
    updated_at=now()
  WHERE id=p_asset AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'fixed_asset.commissioned','fixed_asset',p_asset,
    jsonb_build_object('asset_account',a.pcg_asset_account_code,'in_service_date',a.in_service_date,
      'impairment_account',a.pcg_impairment_account_code),
    jsonb_build_object('commissioning_id',v_event_id,'journal_entry_id',v_journal,
      'new_asset_account',p_new_asset_account_code,'in_service_date',p_event_date,
      'depreciation_method',p_depreciation_method,'useful_life_months',p_useful_life_months,
      'impairment_account',p_impairment_account_code));
  RETURN v_event_id;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_commission_fixed_asset(uuid,uuid,date,text,text,integer,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_commission_fixed_asset(uuid,uuid,date,text,text,integer,text,text,text,text) TO authenticated;

COMMENT ON FUNCTION public.magnisa_commission_fixed_asset(uuid,uuid,date,text,text,integer,text,text,text,text) IS
  'Reclassifies a class-23 work-in-progress asset into its final PCG class-20/21/22 account, moves accumulated impairment when needed, and starts depreciation only from the commissioning date.';
