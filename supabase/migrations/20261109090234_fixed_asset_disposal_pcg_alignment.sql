-- Correct disposal account requirements for non-depreciable and non-impaired assets.
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
  IF NOT FOUND OR a.status NOT IN ('active','fully_depreciated') THEN RAISE EXCEPTION 'Immobilisation inactive ou introuvable'; END IF;
  IF p_proceeds IS NULL OR p_proceeds<0 OR length(trim(coalesce(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'Produit de cession ou motif invalide';
  END IF;
  IF a.pcg_asset_account_code IS NULL OR a.pcg_asset_account_code !~ '^(20|21|22|23|26|27)' THEN
    RAISE EXCEPTION 'Compte d’actif PCG invalide';
  END IF;
  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_carrying := greatest(0,round(v_gross-coalesce(a.accumulated_depreciation,0)-coalesce(a.impairment_loss,0),2));
  v_gain := greatest(0,round(p_proceeds-v_carrying,2));
  v_loss := greatest(0,round(v_carrying-p_proceeds,2));
  IF coalesce(a.accumulated_depreciation,0)>0 THEN
    IF a.pcg_accumulated_depreciation_account_code IS NULL THEN RAISE EXCEPTION 'Compte PCG 28 requis pour sortir les amortissements cumulés'; END IF;
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_accumulated_depreciation_account_code,'debit',a.accumulated_depreciation,'credit',0));
  END IF;
  IF coalesce(a.impairment_loss,0)>0 THEN
    IF a.pcg_impairment_account_code IS NULL THEN RAISE EXCEPTION 'Compte PCG 29 requis pour sortir les pertes de valeur cumulées'; END IF;
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_impairment_account_code,'debit',a.impairment_loss,'credit',0));
  END IF;
  IF p_proceeds>0 THEN
    IF a.pcg_disposal_receivable_account_code IS NULL THEN RAISE EXCEPTION 'Compte PCG 462 requis pour le produit de cession'; END IF;
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_disposal_receivable_account_code,'debit',p_proceeds,'credit',0));
  END IF;
  IF v_loss>0 THEN
    IF a.pcg_disposal_expense_account_code IS NULL THEN RAISE EXCEPTION 'Compte PCG 652 requis pour la moins-value de cession'; END IF;
    v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_disposal_expense_account_code,'debit',v_loss,'credit',0));
  END IF;
  v_lines := v_lines||jsonb_build_array(jsonb_build_object('account_kind','pcg','pcg_code',a.pcg_asset_account_code,'debit',0,'credit',v_gross));
  IF v_gain>0 THEN
    IF a.pcg_disposal_income_account_code IS NULL THEN RAISE EXCEPTION 'Compte PCG 752 requis pour la plus-value de cession'; END IF;
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

REVOKE ALL ON FUNCTION public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_dispose_fixed_asset(uuid,uuid,date,numeric,text) TO authenticated;
