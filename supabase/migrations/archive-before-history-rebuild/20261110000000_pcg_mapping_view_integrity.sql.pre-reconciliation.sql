-- Keep generic expense keys out of asset/liability/equity accounts.
-- Treat internal transfer suspense keys as PCG 581 by their explicit source type.
-- Preserve original journal entries and mapping rows; invalid generic mappings remain visible as a_mapper.
CREATE OR REPLACE VIEW public.pcg2005_journal_lines
WITH (security_invoker = true) AS
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
    CASE
      WHEN jl.account_key LIKE 'PCG:%' THEN SUBSTRING(jl.account_key FROM 5)
      ELSE NULL::text
    END,
    CASE
      WHEN jl.account_key LIKE 'TRANSIT:%' THEN '581'::text
      ELSE NULL::text
    END,
    CASE
      WHEN m.pcg_code IS NOT NULL
        AND (jl.account_key NOT LIKE 'EXPENSE:%' OR mapped_pcg.kind = 'expense')
      THEN m.pcg_code
      ELSE NULL::text
    END,
    CASE
      WHEN jl.account_key = 'AR' THEN '411'
      WHEN jl.account_key = 'AP' THEN '401'
      WHEN jl.account_key = 'SALES_REVENUE' THEN '706'
      WHEN jl.account_key = 'TAX_PAYABLE:PAYROLL' THEN '442'
      WHEN jl.account_key LIKE 'TAX_PAYABLE%' THEN '445'
      WHEN jl.account_key = 'PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key = 'EMPLOYEE_ADVANCE_RECEIVABLE' THEN '425'
      WHEN jl.account_key = 'SOCIAL_PAYABLE' THEN '431'
      WHEN jl.account_key = 'HEALTH_PAYABLE' THEN '431'
      WHEN jl.account_key = 'OTHER_PAYROLL_PAYABLE' THEN '421'
      WHEN jl.account_key = ANY (ARRAY['SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE']) THEN '431'
      WHEN jl.account_key = 'PAYROLL_EXPENSE:GROSS' THEN '641'
      WHEN jl.account_key = ANY (ARRAY['PAYROLL_EXPENSE:EMPLOYER_CONTRIBUTIONS','PAYROLL_EXPENSE:SUPPLEMENTARY_PENSION']) THEN '645'
      WHEN jl.account_key LIKE 'PAYROLL_EXPENSE:%' THEN '641'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type = 'bank' THEN '512'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type = 'cash' THEN '53'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type = 'mobile_money' THEN '517'
      WHEN jl.account_key LIKE 'TREASURY:%' AND fa.type = 'cheque_clearing' THEN '511'
      ELSE NULL::text
    END
  ) AS pcg_code,
  CASE
    WHEN jl.account_key LIKE 'PCG:%' THEN 'automatique'
    WHEN jl.account_key LIKE 'TRANSIT:%' THEN 'automatique'
    WHEN m.pcg_code IS NOT NULL
      AND (jl.account_key NOT LIKE 'EXPENSE:%' OR mapped_pcg.kind = 'expense') THEN 'manuel'
    WHEN jl.account_key = ANY (ARRAY[
      'AR','AP','SALES_REVENUE','PAYROLL_PAYABLE','EMPLOYEE_ADVANCE_RECEIVABLE',
      'SOCIAL_PAYABLE','HEALTH_PAYABLE','OTHER_PAYROLL_PAYABLE',
      'SUPPLEMENTARY_PENSION_PAYABLE','EMPLOYEE_SUPPLEMENTARY_PENSION_PAYABLE'
    ])
      OR jl.account_key LIKE 'TAX_PAYABLE%'
      OR jl.account_key LIKE 'PAYROLL_EXPENSE:%'
      OR (jl.account_key LIKE 'TREASURY:%' AND fa.type IS NOT NULL)
    THEN 'automatique'
    ELSE 'a_mapper'
  END AS mapping_status
FROM public.journal_entry_lines jl
JOIN public.journal_entries je
  ON je.id = jl.journal_entry_id
 AND je.organization_id = jl.organization_id
LEFT JOIN public.financial_accounts fa
  ON fa.id = jl.financial_account_id
 AND fa.organization_id = jl.organization_id
LEFT JOIN public.pcg2005_account_mappings m
  ON m.organization_id = jl.organization_id
 AND m.legacy_account_key = jl.account_key
LEFT JOIN public.pcg2005_accounts mapped_pcg
  ON mapped_pcg.code = m.pcg_code;

-- The view is read-only in the application; authenticated clients only need SELECT.
REVOKE INSERT, UPDATE, DELETE ON public.pcg2005_journal_lines FROM anon, authenticated;
GRANT SELECT ON public.pcg2005_journal_lines TO authenticated;
