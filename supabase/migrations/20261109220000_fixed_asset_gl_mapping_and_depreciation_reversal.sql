-- Direct PCG journal lines must be visible to the PCG trial balance and fixed-asset reconciliation.
CREATE OR REPLACE VIEW public.pcg2005_journal_lines
WITH (security_invoker=true) AS
SELECT
  jl.organization_id, je.id AS journal_entry_id, je.entry_date,
  je.reference, je.status, je.source_type, jl.id AS line_id, jl.account_key, jl.account_label,
  jl.debit, jl.credit, jl.customer_id, jl.financial_account_id,
  coalesce(
    CASE WHEN jl.account_key LIKE 'PCG:%' THEN substring(jl.account_key FROM 5) END,
    m.pcg_code,
    CASE
      WHEN jl.account_key='AR' THEN '411'
      WHEN jl.account_key='AP' THEN '401'
      WHEN jl.account_key='SALES_REVENUE' THEN '706'
      WHEN jl.account_key='TAX_PAYABLE:PAYROLL' THEN '442'
      WHEN jl.account_key LIKE 'TAX_PAYABLE%' THEN '445'
      WHEN jl.account_key='PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key='EMPLOYEE_ADVANCE_RECEIVABLE' THEN '425'
      WHEN jl.account_key='SOCIAL_PAYABLE' THEN '431'
      WHEN jl.account_key='HEALTH_PAYABLE' THEN '431'
      WHEN jl.account_key='OTHER_PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key IN ('SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE') THEN '431'
      WHEN jl.account_key='PAYROLL_EXPENSE:GROSS' THEN '641'
      WHEN jl.account_key IN ('PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION') THEN '645'
      WHEN jl.account_key LIKE 'PAYROLL_EXPENSE:%' THEN '641'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='bank' THEN '512'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='cash' THEN '53'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='mobile_money' THEN '517'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='cheque_clearing' THEN '511'
      ELSE NULL
    END
  ) AS pcg_code,
  CASE
    WHEN jl.account_key LIKE 'PCG:%' THEN 'automatique'
    WHEN m.pcg_code IS NOT NULL THEN 'manuel'
    WHEN jl.account_key IN ('AR','AP','SALES_REVENUE','PAYROLL_PAYABLE','EMPLOYEE_ADVANCE_RECEIVABLE','SOCIAL_PAYABLE','HEALTH_PAYABLE','OTHER_PAYROLL_PAYABLE','SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE')
      OR jl.account_key LIKE 'TAX_PAYABLE%' OR jl.account_key LIKE 'PAYROLL_EXPENSE:%'
      OR (jl.account_key LIKE 'TREASURY:%' AND fa.type IS NOT NULL)
      THEN 'automatique'
    ELSE 'a_mapper'
  END AS mapping_status
FROM public.journal_entry_lines jl
JOIN public.journal_entries je ON je.id=jl.journal_entry_id AND je.organization_id=jl.organization_id
LEFT JOIN public.financial_accounts fa ON fa.id=jl.financial_account_id AND fa.organization_id=jl.organization_id
LEFT JOIN public.pcg2005_account_mappings m
  ON m.organization_id=jl.organization_id AND m.legacy_account_key=jl.account_key;

REVOKE ALL ON public.pcg2005_journal_lines FROM anon;
GRANT SELECT ON public.pcg2005_journal_lines TO authenticated;

ALTER TABLE public.fixed_asset_depreciation_entries
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_depreciation_reversal_journal_uidx
  ON public.fixed_asset_depreciation_entries(reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.magnisa_reverse_fixed_asset_depreciation(
  p_org uuid,p_depreciation_entry uuid,p_reversal_date date,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d public.fixed_asset_depreciation_entries%rowtype;
  a public.fixed_assets%rowtype;
  v_lines jsonb;
  v_journal uuid;
  v_gross numeric(18,2);
  v_new_nbv numeric(18,2);
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Motif de contrepassation obligatoire'; END IF;

  SELECT * INTO d FROM public.fixed_asset_depreciation_entries
  WHERE id=p_depreciation_entry AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR d.status<>'posted' OR d.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Seule une dotation comptabilisée avec écriture peut être contrepassée';
  END IF;
  IF p_reversal_date<d.period_end THEN RAISE EXCEPTION 'La contrepassation doit intervenir à la date de clôture de la période ou après'; END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,p_reversal_date);

  IF EXISTS (
    SELECT 1 FROM public.fixed_asset_depreciation_entries
    WHERE organization_id=p_org AND fixed_asset_id=d.fixed_asset_id
      AND status='posted' AND period_end>d.period_end
  ) THEN
    RAISE EXCEPTION 'Contrepassation refusée : contre-passe d’abord les périodes d’amortissement postérieures';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fixed_asset_impairments
    WHERE organization_id=p_org AND fixed_asset_id=d.fixed_asset_id
      AND event_date>d.period_end
  ) THEN
    RAISE EXCEPTION 'Contrepassation refusée : un mouvement de dépréciation postérieur existe';
  END IF;

  SELECT * INTO a FROM public.fixed_assets
  WHERE id=d.fixed_asset_id AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status='disposed' THEN RAISE EXCEPTION 'Immobilisation sortie ou introuvable'; END IF;
  IF round(coalesce(a.accumulated_depreciation,0),2)<>round(d.closing_accumulated_depreciation,2) THEN
    RAISE EXCEPTION 'Contrepassation refusée : le cumul du registre ne correspond plus à la dotation sélectionnée';
  END IF;
  IF a.component_reference='componentized_parent' THEN RAISE EXCEPTION 'La fiche mère a été ventilée en composants'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'account_kind','pcg',
    'pcg_code',substring(account_key FROM 5),
    'debit',credit,
    'credit',debit
  ) ORDER BY id)
  INTO v_lines
  FROM public.journal_entry_lines
  WHERE organization_id=p_org AND journal_entry_id=d.journal_entry_id
    AND account_key LIKE 'PCG:%';
  IF coalesce(jsonb_array_length(v_lines),0)<2 THEN
    RAISE EXCEPTION 'L’écriture d’origine ne contient pas deux lignes PCG contrepassables';
  END IF;

  v_journal := public.magnisa_post_journal(
    p_org,p_reversal_date,'ANN-DOT-IMM-'||left(d.id::text,12),
    'Contrepassation dotation immobilisation','fixed_asset_depreciation_reversal',d.id,v_lines
  );

  v_gross := round(a.acquisition_cost+coalesce(a.directly_attributable_cost,0),2);
  v_new_nbv := greatest(0,round(v_gross-d.opening_accumulated_depreciation-coalesce(a.impairment_loss,0),2));
  UPDATE public.fixed_asset_depreciation_entries
  SET status='reversed',reversal_journal_entry_id=v_journal,
      reversed_at=now(),reversed_by=auth.uid(),reversal_reason=trim(p_reason),updated_at=now()
  WHERE id=d.id AND organization_id=p_org;

  UPDATE public.fixed_assets
  SET accumulated_depreciation=d.opening_accumulated_depreciation,
      net_book_value=v_new_nbv,
      status=CASE WHEN d.opening_accumulated_depreciation>=greatest(0,v_gross-coalesce(residual_value,0))
        THEN 'fully_depreciated' ELSE 'active' END,
      updated_at=now()
  WHERE id=a.id AND organization_id=p_org;

  PERFORM public.audit_event(p_org,'fixed_asset.depreciation.reversed','fixed_asset_depreciation',d.id,
    jsonb_build_object('journal_entry_id',d.journal_entry_id,'closing_accumulated_depreciation',d.closing_accumulated_depreciation),
    jsonb_build_object('reversal_journal_entry_id',v_journal,'reversal_date',p_reversal_date,'reason',trim(p_reason)));
  RETURN v_journal;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_reverse_fixed_asset_depreciation(uuid,uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_reverse_fixed_asset_depreciation(uuid,uuid,date,text) TO authenticated;
COMMENT ON COLUMN public.fixed_asset_depreciation_entries.reversal_journal_entry_id IS
  'Journal de contrepassation. L’écriture d’origine reste intacte et le plan passe au statut reversed.';
