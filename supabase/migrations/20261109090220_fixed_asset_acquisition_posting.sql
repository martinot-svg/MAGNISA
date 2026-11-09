-- MAGNISA: acquisition posting for the existing fixed-asset register.
-- Asset registration remains a draft-like operational step; this RPC posts the acquisition only on explicit user action.
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS pcg_acquisition_counterpart_account_code text,
  ADD COLUMN IF NOT EXISTS acquisition_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT;

INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('404','Fournisseurs d’immobilisations','liability')
ON CONFLICT (code) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_acquisition_journal_uidx
  ON public.fixed_assets(acquisition_journal_entry_id)
  WHERE acquisition_journal_entry_id IS NOT NULL;

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
  SELECT * INTO a FROM public.fixed_assets
  WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active','fully_depreciated') THEN
    RAISE EXCEPTION 'Immobilisation introuvable ou non comptabilisable';
  END IF;
  IF a.acquisition_journal_entry_id IS NOT NULL THEN RETURN a.acquisition_journal_entry_id; END IF;
  IF a.pcg_asset_account_code IS NULL OR a.pcg_acquisition_counterpart_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte d’immobilisation et contrepartie d’acquisition obligatoires';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,a.acquisition_date);
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_asset_account_code;
  IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Compte d’actif PCG invalide'; END IF;
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_acquisition_counterpart_account_code;
  IF v_kind NOT IN ('liability','asset') THEN RAISE EXCEPTION 'La contrepartie doit être un compte fournisseur ou de trésorerie'; END IF;
  v_amount := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  IF v_amount<=0 THEN RAISE EXCEPTION 'Le coût immobilisable doit être positif'; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_asset_account_code,'debit',v_amount,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_acquisition_counterpart_account_code,'debit',0,'credit',v_amount)
  );
  v_journal := public.magnisa_post_journal(
    p_org,a.acquisition_date,'ACH-IMM-'||left(a.id::text,12),
    'Acquisition immobilisation - '||a.name,'fixed_asset_acquisition',a.id,v_lines
  );
  UPDATE public.fixed_assets SET acquisition_journal_entry_id=v_journal,updated_at=now()
  WHERE id=a.id AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.acquisition.posted','fixed_asset',a.id,NULL,
    jsonb_build_object('journal_entry_id',v_journal,'gross_cost',v_amount,
      'asset_account',a.pcg_asset_account_code,'counterpart_account',a.pcg_acquisition_counterpart_account_code));
  RETURN v_journal;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_post_fixed_asset_acquisition(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_post_fixed_asset_acquisition(uuid,uuid) TO authenticated;

COMMENT ON COLUMN public.fixed_assets.acquisition_journal_entry_id IS
  'Journal PCG de l’acquisition. Null signifie que la fiche existe mais que son acquisition n’est pas encore comptabilisée.';
