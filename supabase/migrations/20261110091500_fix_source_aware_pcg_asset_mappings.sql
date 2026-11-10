-- Correct known false PCG mappings and classify internal-transfer clearing lines.
-- No journal entry or manual mapping row is rewritten. The ledger view applies
-- source-aware, evidence-based overrides and leaves ambiguous legacy expense classes unmapped.

CREATE OR REPLACE VIEW public.pcg2005_journal_lines
WITH (security_invoker=true) AS
SELECT
  jl.organization_id, je.id AS journal_entry_id, je.entry_date,
  je.reference, je.status, je.source_type, jl.id AS line_id, jl.account_key, jl.account_label,
  jl.debit, jl.credit, jl.customer_id, jl.financial_account_id,
  CASE
    WHEN jl.source_type IN ('internal_transfer_debit','internal_transfer_credit') AND jl.account_key LIKE 'TRANSIT:%' THEN '581'
    WHEN jl.source_type='expense' AND jl.account_key='EXPENSE:transport' THEN
      CASE WHEN e.description ILIKE '%déplacement%' OR e.description ILIKE '%deplacement%' THEN '625' ELSE NULL END
    WHEN jl.source_type='expense' AND jl.account_key IN ('EXPENSE:acquisition','EXPENSE:achat_de_mat_riel_informatique') THEN NULL
    WHEN jl.source_type='supplier_invoice' AND jl.account_key='EXPENSE:SUPPLIER' THEN NULL
    ELSE coalesce(
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
    )
  END AS pcg_code,
  CASE
    WHEN jl.source_type IN ('internal_transfer_debit','internal_transfer_credit') AND jl.account_key LIKE 'TRANSIT:%' THEN 'automatique'
    WHEN jl.source_type='expense' AND jl.account_key='EXPENSE:transport' AND (e.description ILIKE '%déplacement%' OR e.description ILIKE '%deplacement%') THEN 'automatique'
    WHEN jl.source_type='expense' AND jl.account_key IN ('EXPENSE:transport','EXPENSE:acquisition','EXPENSE:achat_de_mat_riel_informatique') THEN 'a_mapper'
    WHEN jl.source_type='supplier_invoice' AND jl.account_key='EXPENSE:SUPPLIER' THEN 'a_mapper'
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
  ON m.organization_id=jl.organization_id AND m.legacy_account_key=jl.account_key
LEFT JOIN public.expenses e
  ON e.id=je.source_id AND e.organization_id=jl.organization_id;

REVOKE ALL ON public.pcg2005_journal_lines FROM anon;
GRANT SELECT ON public.pcg2005_journal_lines TO authenticated;

REVOKE ALL ON public.pcg2005_journal_lines FROM anon;
GRANT SELECT ON public.pcg2005_journal_lines TO authenticated;

COMMENT ON VIEW public.pcg2005_journal_lines IS
  'PCG ledger projection. Internal transfers are mapped to 581. Travel expense is mapped to 625 only when the source expense description identifies a déplacement. Generic acquisition, IT equipment and supplier expense keys are deliberately left unmapped until capitalization/expense nature is evidenced.';
