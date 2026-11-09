-- Distinguish pre-existing assets from newly registered assets before enforcing accounting workflow gates.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS legacy_accounting_origin boolean NOT NULL DEFAULT false;

UPDATE public.fixed_assets
SET legacy_accounting_origin=true
WHERE acquisition_journal_entry_id IS NULL
  AND legacy_accounting_origin=false;

CREATE OR REPLACE FUNCTION public.magnisa_guard_fixed_asset_posting_origin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_asset uuid;
  v_org uuid;
  v_acquisition_journal uuid;
  v_legacy boolean;
BEGIN
  v_asset := NEW.fixed_asset_id;
  v_org := NEW.organization_id;
  SELECT acquisition_journal_entry_id,legacy_accounting_origin
    INTO v_acquisition_journal,v_legacy
  FROM public.fixed_assets
  WHERE id=v_asset AND organization_id=v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Immobilisation introuvable pour cette opération'; END IF;
  IF v_acquisition_journal IS NULL AND NOT coalesce(v_legacy,false) THEN
    RAISE EXCEPTION 'Comptabilise d’abord l’acquisition de cette immobilisation avant toute dotation, dépréciation ou sortie';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fixed_asset_depreciation_origin_guard ON public.fixed_asset_depreciation_entries;
CREATE TRIGGER fixed_asset_depreciation_origin_guard
BEFORE UPDATE OF status,journal_entry_id ON public.fixed_asset_depreciation_entries
FOR EACH ROW WHEN (NEW.status='posted')
EXECUTE FUNCTION public.magnisa_guard_fixed_asset_posting_origin();

DROP TRIGGER IF EXISTS fixed_asset_impairment_origin_guard ON public.fixed_asset_impairments;
CREATE TRIGGER fixed_asset_impairment_origin_guard
BEFORE UPDATE OF journal_entry_id ON public.fixed_asset_impairments
FOR EACH ROW WHEN (NEW.journal_entry_id IS NOT NULL)
EXECUTE FUNCTION public.magnisa_guard_fixed_asset_posting_origin();

DROP TRIGGER IF EXISTS fixed_asset_disposal_origin_guard ON public.fixed_asset_disposals;
CREATE TRIGGER fixed_asset_disposal_origin_guard
BEFORE UPDATE OF journal_entry_id ON public.fixed_asset_disposals
FOR EACH ROW WHEN (NEW.journal_entry_id IS NOT NULL)
EXECUTE FUNCTION public.magnisa_guard_fixed_asset_posting_origin();

CREATE OR REPLACE FUNCTION public.magnisa_post_fixed_asset_acquisition(
  p_org uuid,p_asset uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_assets%rowtype;
  v_amount numeric(18,2);
  v_journal uuid;
  v_lines jsonb;
  v_kind text;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO a FROM public.fixed_assets WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active','fully_depreciated') THEN RAISE EXCEPTION 'Immobilisation introuvable ou non comptabilisable'; END IF;
  IF a.legacy_accounting_origin THEN
    RAISE EXCEPTION 'Immobilisation historique : ne reposte pas son acquisition. Rapproche ses soldes existants avec le grand livre.';
  END IF;
  IF a.acquisition_journal_entry_id IS NOT NULL THEN RETURN a.acquisition_journal_entry_id; END IF;
  IF a.pcg_asset_account_code IS NULL OR a.pcg_acquisition_counterpart_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte d’immobilisation et contrepartie d’acquisition obligatoires';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,a.acquisition_date);
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_asset_account_code;
  IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Compte d’actif PCG invalide'; END IF;
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_acquisition_counterpart_account_code;
  IF coalesce(v_kind,'') NOT IN ('liability','asset','equity','income') THEN RAISE EXCEPTION 'La contrepartie PCG doit être un compte autorisé de tiers, trésorerie, capitaux propres ou production immobilisée'; END IF;
  v_amount := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  IF v_amount<=0 THEN RAISE EXCEPTION 'Le coût immobilisable doit être positif'; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_asset_account_code,'debit',v_amount,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_acquisition_counterpart_account_code,'debit',0,'credit',v_amount)
  );
  v_journal := public.magnisa_post_journal(p_org,a.acquisition_date,'ACH-IMM-'||left(a.id::text,12),
    'Acquisition immobilisation - '||a.name,'fixed_asset_acquisition',a.id,v_lines);
  UPDATE public.fixed_assets SET acquisition_journal_entry_id=v_journal,updated_at=now()
  WHERE id=a.id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.acquisition.posted','fixed_asset',a.id,NULL,
    jsonb_build_object('journal_entry_id',v_journal,'gross_cost',v_amount,
      'asset_account',a.pcg_asset_account_code,'counterpart_account',a.pcg_acquisition_counterpart_account_code));
  RETURN v_journal;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_guard_fixed_asset_posting_origin() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.magnisa_post_fixed_asset_acquisition(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_post_fixed_asset_acquisition(uuid,uuid) TO authenticated;
COMMENT ON COLUMN public.fixed_assets.legacy_accounting_origin IS
  'True for assets already present before this module. Their opening balances must be reconciled, never reposted as new acquisitions.';
