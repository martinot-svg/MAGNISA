-- Audit en lecture seule - MAGNISA Paie/Comptabilite
-- A executer sur Supabase SQL editor avec un role habilite.
-- Aucun INSERT, UPDATE, DELETE ou fonction de paiement.
SELECT 'journal_imbalance' AS test, count(*) AS anomalies
FROM public.journal_entries WHERE abs(total_debit-total_credit)>0.01
UNION ALL
SELECT 'journal_header_lines',count(*)
FROM public.journal_entries j LEFT JOIN (
 SELECT journal_entry_id,sum(debit) debit,sum(credit) credit
 FROM public.journal_entry_lines GROUP BY journal_entry_id
) l ON l.journal_entry_id=j.id
WHERE abs(j.total_debit-coalesce(l.debit,0))>0.01
   OR abs(j.total_credit-coalesce(l.credit,0))>0.01
UNION ALL
SELECT 'duplicate_payslip_source',count(*) FROM (
 SELECT organization_id,source_id FROM public.journal_entries
 WHERE source_type='payslip' AND source_id IS NOT NULL
 GROUP BY organization_id,source_id HAVING count(*)>1
) x
UNION ALL
SELECT 'duplicate_payroll_payment_source',count(*) FROM (
 SELECT organization_id,source_id FROM public.journal_entries
 WHERE source_type='payroll_payment' AND source_id IS NOT NULL
 GROUP BY organization_id,source_id HAVING count(*)>1
) x
UNION ALL
SELECT 'orphan_payroll_validation',count(*) FROM public.journal_entries j
LEFT JOIN public.payslips ps ON ps.id=j.source_id AND ps.organization_id=j.organization_id
WHERE j.source_type='payslip' AND ps.id IS NULL
UNION ALL
SELECT 'orphan_payroll_payment',count(*) FROM public.journal_entries j
LEFT JOIN public.payroll_payments p ON p.id=j.source_id AND p.organization_id=j.organization_id
WHERE j.source_type='payroll_payment' AND p.id IS NULL;
