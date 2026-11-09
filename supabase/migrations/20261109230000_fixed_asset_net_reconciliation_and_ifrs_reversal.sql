-- Compare register and ledger net balances, not gross lifetime debit/credit movements.
CREATE OR REPLACE VIEW public.fixed_asset_register_reconciliation
WITH (security_invoker=true) AS
WITH register_balances AS (
  SELECT organization_id,pcg_asset_account_code AS account_code,
    sum(acquisition_cost+coalesce(directly_attributable_cost,0))::numeric(20,2) AS register_debit,
    0::numeric(20,2) AS register_credit
  FROM public.fixed_assets
  WHERE status<>'disposed' AND pcg_asset_account_code IS NOT NULL
  GROUP BY organization_id,pcg_asset_account_code
  UNION ALL
  SELECT organization_id,pcg_accumulated_depreciation_account_code,
    0::numeric(20,2),sum(accumulated_depreciation)::numeric(20,2)
  FROM public.fixed_assets
  WHERE status<>'disposed' AND pcg_accumulated_depreciation_account_code IS NOT NULL
  GROUP BY organization_id,pcg_accumulated_depreciation_account_code
  UNION ALL
  SELECT organization_id,pcg_impairment_account_code,
    0::numeric(20,2),sum(impairment_loss)::numeric(20,2)
  FROM public.fixed_assets
  WHERE status<>'disposed' AND pcg_impairment_account_code IS NOT NULL
  GROUP BY organization_id,pcg_impairment_account_code
),
register_totals AS (
  SELECT organization_id,account_code,sum(register_debit)::numeric(20,2) AS register_debit,
    sum(register_credit)::numeric(20,2) AS register_credit
  FROM register_balances GROUP BY organization_id,account_code
),
ledger_totals AS (
  SELECT organization_id,pcg_code AS account_code,
    sum(debit-credit)::numeric(20,2) AS ledger_net
  FROM public.pcg2005_journal_lines
  WHERE status='posted' AND pcg_code ~ '^(20|21|22[0-8]|23|26|27|28|29)'
  GROUP BY organization_id,pcg_code
)
SELECT coalesce(r.organization_id,l.organization_id) AS organization_id,
  coalesce(r.account_code,l.account_code) AS account_code,
  coalesce(r.register_debit,0)::numeric(20,2) AS register_debit,
  coalesce(r.register_credit,0)::numeric(20,2) AS register_credit,
  greatest(coalesce(l.ledger_net,0),0)::numeric(20,2) AS ledger_debit,
  greatest(-coalesce(l.ledger_net,0),0)::numeric(20,2) AS ledger_credit,
  (coalesce(r.register_debit,0)-greatest(coalesce(l.ledger_net,0),0))::numeric AS debit_difference,
  (coalesce(r.register_credit,0)-greatest(-coalesce(l.ledger_net,0),0))::numeric AS credit_difference,
  CASE WHEN abs(coalesce(r.register_debit,0)-greatest(coalesce(l.ledger_net,0),0))<0.01
         AND abs(coalesce(r.register_credit,0)-greatest(-coalesce(l.ledger_net,0),0))<0.01
       THEN 'reconciled' ELSE 'difference' END AS reconciliation_status
FROM register_totals r
FULL OUTER JOIN ledger_totals l
  ON l.organization_id=r.organization_id AND l.account_code=r.account_code;

REVOKE ALL ON public.fixed_asset_register_reconciliation FROM anon;
GRANT SELECT ON public.fixed_asset_register_reconciliation TO authenticated;
COMMENT ON VIEW public.fixed_asset_register_reconciliation IS
  'Rapprochement net par compte PCG entre les valeurs brutes, amortissements et dépréciations du registre et les soldes nets du grand livre. Les contrepassations et sorties sont prises en compte.';

ALTER TABLE public.fixed_asset_ifrs_adjustments
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE OR REPLACE FUNCTION public.magnisa_reverse_fixed_asset_ifrs_adjustment(
  p_org uuid,p_adjustment uuid,p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  a public.fixed_asset_ifrs_adjustments%rowtype;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Motif de contrepassation IFRS obligatoire'; END IF;
  SELECT * INTO a FROM public.fixed_asset_ifrs_adjustments
  WHERE id=p_adjustment AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR a.status<>'approved' THEN
    RAISE EXCEPTION 'Seul un ajustement IFRS approuvé peut être contrepassé';
  END IF;
  UPDATE public.fixed_asset_ifrs_adjustments
  SET status='reversed',reversed_by=auth.uid(),reversed_at=now(),reversal_reason=trim(p_reason)
  WHERE id=p_adjustment AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'fixed_asset.ifrs_adjustment.reversed','fixed_asset_ifrs_adjustment',p_adjustment,
    jsonb_build_object('status',a.status,'adjustment_amount',a.adjustment_amount),
    jsonb_build_object('status','reversed','reversal_reason',trim(p_reason)));
  RETURN p_adjustment;
END $$;

REVOKE ALL ON FUNCTION public.magnisa_reverse_fixed_asset_ifrs_adjustment(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_reverse_fixed_asset_ifrs_adjustment(uuid,uuid,text) TO authenticated;
COMMENT ON COLUMN public.fixed_asset_ifrs_adjustments.reversal_reason IS
  'Motif d’annulation d’un ajustement IFRS. Les valeurs et justifications d’origine restent conservées.';
