-- Lock down lifecycle ledgers: changes must pass through SECURITY DEFINER accounting workflows.
REVOKE INSERT,UPDATE,DELETE ON public.fixed_asset_depreciation_entries FROM authenticated;
GRANT SELECT ON public.fixed_asset_depreciation_entries TO authenticated;

REVOKE UPDATE,DELETE ON public.fixed_asset_impairments FROM authenticated;
REVOKE UPDATE,DELETE ON public.fixed_asset_disposals FROM authenticated;
REVOKE UPDATE,DELETE ON public.fixed_asset_transfers FROM authenticated;
REVOKE UPDATE,DELETE ON public.fixed_asset_ifrs_adjustments FROM authenticated;
DROP POLICY IF EXISTS fixed_asset_impairments_update ON public.fixed_asset_impairments;
DROP POLICY IF EXISTS fixed_asset_disposals_update ON public.fixed_asset_disposals;
DROP POLICY IF EXISTS fixed_asset_transfers_update ON public.fixed_asset_transfers;
DROP POLICY IF EXISTS fixed_asset_ifrs_adjustments_update ON public.fixed_asset_ifrs_adjustments;

ALTER TABLE public.fixed_asset_impairments
  ADD COLUMN IF NOT EXISTS reversal_of uuid REFERENCES public.fixed_asset_impairments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_impairments_one_reversal_uidx
  ON public.fixed_asset_impairments(organization_id,reversal_of)
  WHERE reversal_of IS NOT NULL;

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
  IF EXISTS (SELECT 1 FROM public.fixed_asset_impairments WHERE organization_id=p_org AND reversal_of=p_impairment) THEN
    RAISE EXCEPTION 'Cette dépréciation a déjà fait l’objet d’une reprise';
  END IF;
  SELECT * INTO a FROM public.fixed_assets WHERE id=i.fixed_asset_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('active','fully_depreciated') THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF a.pcg_impairment_account_code IS NULL OR a.pcg_impairment_reversal_income_account_code IS NULL THEN
    RAISE EXCEPTION 'Comptes PCG de reprise non configurés';
  END IF;
  v_reversal := least(i.amount,coalesce(a.impairment_loss,0));
  IF v_reversal<=0 THEN RAISE EXCEPTION 'Aucune dépréciation à reprendre'; END IF;
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Une justification de reprise est obligatoire'; END IF;
  INSERT INTO public.fixed_asset_impairments(organization_id,fixed_asset_id,event_type,event_date,amount,recoverable_amount,reason,reversal_of,created_by)
  VALUES(p_org,i.fixed_asset_id,'reversal',p_date,v_reversal,
    least(a.acquisition_cost+coalesce(a.directly_attributable_cost,0)-coalesce(a.accumulated_depreciation,0),
      a.net_book_value+v_reversal),trim(p_reason),p_impairment,auth.uid())
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

-- Reject an unknown counterpart account (NULL is not accepted by SQL's three-valued NOT IN logic).
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
  IF a.acquisition_journal_entry_id IS NOT NULL THEN RETURN a.acquisition_journal_entry_id; END IF;
  IF a.pcg_asset_account_code IS NULL OR a.pcg_acquisition_counterpart_account_code IS NULL THEN
    RAISE EXCEPTION 'Compte d’immobilisation et contrepartie d’acquisition obligatoires';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,a.acquisition_date);
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_asset_account_code;
  IF v_kind IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Compte d’actif PCG invalide'; END IF;
  SELECT kind INTO v_kind FROM public.pcg2005_accounts WHERE code=a.pcg_acquisition_counterpart_account_code;
  IF coalesce(v_kind,'') NOT IN ('liability','asset') THEN RAISE EXCEPTION 'La contrepartie doit être un compte fournisseur ou de trésorerie'; END IF;
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
