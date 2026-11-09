-- Internal transfer clearing accounts are system-generated and have one unambiguous PCG 2005 mapping.
-- Manual organization mappings remain higher priority through the existing COALESCE(m.pcg_code, ...).

DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pcg2005_accounts WHERE code='581') THEN
    RAISE EXCEPTION 'PCG 2005 account 581 is missing; refusing to classify internal transfer clearing accounts.';
  END IF;
END;
$assert$;

CREATE OR REPLACE VIEW public.pcg2005_journal_lines
WITH (security_invoker=true)
AS
SELECT
  jl.organization_id,
  je.id AS journal_entry_id,
  je.entry_date,
  je.reference,
  je.status,
  je.source_type,
  jl.id AS line_id,
  jl.account_key,
  jl.account_label,
  jl.debit,
  jl.credit,
  jl.customer_id,
  jl.financial_account_id,
  COALESCE(
    m.pcg_code,
    CASE
      WHEN jl.account_key LIKE 'PCG:%' THEN SUBSTRING(jl.account_key FROM 5)
      WHEN jl.account_key='AR' THEN '411'
      WHEN jl.account_key='AP' THEN '401'
      WHEN jl.account_key='SALES_REVENUE' THEN '706'
      WHEN jl.account_key='TAX_PAYABLE:PAYROLL' THEN '442'
      WHEN jl.account_key LIKE 'TAX_PAYABLE%' THEN '445'
      WHEN jl.account_key='PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key='EMPLOYEE_ADVANCE_RECEIVABLE' THEN '425'
      WHEN jl.account_key=ANY(ARRAY[
        'SOCIAL_PAYABLE','HEALTH_PAYABLE','FMFP_PAYABLE',
        'SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE'
      ]) THEN '431'
      WHEN jl.account_key='OTHER_PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key=ANY(ARRAY[
        'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS',
        'PAYROLL_EXPENSE:FMFP',
        'PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION'
      ]) THEN '645'
      WHEN jl.account_key='PAYROLL_EXPENSE:GROSS' THEN '641'
      WHEN jl.account_key LIKE 'PAYROLL_EXPENSE:%' THEN '641'
      WHEN jl.account_key LIKE 'TRANSIT:%' THEN '581'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='bank' THEN '512'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='cash' THEN '53'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='mobile_money' THEN '517'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type='cheque_clearing' THEN '511'
      ELSE NULL
    END
  ) AS pcg_code,
  CASE
    WHEN m.pcg_code IS NOT NULL THEN 'manuel'
    WHEN jl.account_key LIKE 'TRANSIT:%' THEN 'automatique'
    WHEN jl.account_key LIKE 'PCG:%'
      OR jl.account_key=ANY(ARRAY[
        'AR','AP','SALES_REVENUE','PAYROLL_PAYABLE','EMPLOYEE_ADVANCE_RECEIVABLE',
        'SOCIAL_PAYABLE','HEALTH_PAYABLE','FMFP_PAYABLE',
        'SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE',
        'OTHER_PAYROLL_PAYABLE','PAYROLL_EXPENSE:GROSS',
        'PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','PAYROLL_EXPENSE:FMFP',
        'PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION'
      ])
      OR jl.account_key LIKE 'TAX_PAYABLE%'
      OR jl.account_key LIKE 'PAYROLL_EXPENSE:%'
      OR (jl.account_key LIKE 'TREASURY:%' AND fa.type IS NOT NULL)
      THEN 'automatique'
    ELSE 'a_mapper'
  END AS mapping_status
FROM public.journal_entry_lines jl
JOIN public.journal_entries je
  ON je.id=jl.journal_entry_id AND je.organization_id=jl.organization_id
LEFT JOIN public.financial_accounts fa
  ON fa.id=jl.financial_account_id AND fa.organization_id=jl.organization_id
LEFT JOIN public.pcg2005_account_mappings m
  ON m.organization_id=jl.organization_id AND m.legacy_account_key=jl.account_key;

COMMENT ON VIEW public.pcg2005_journal_lines IS
  'Journal lines with organization overrides first, then validated automatic PCG mappings including internal transfer clearing to account 581.';
