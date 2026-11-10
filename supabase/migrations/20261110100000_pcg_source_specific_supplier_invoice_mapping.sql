-- Source-specific PCG 2005 classification from supplier-invoice records, with evidence gaps retained.
-- The generic EXPENSE:SUPPLIER mapping must not classify every supplier invoice as an asset.

INSERT INTO public.pcg2005_accounts(code,label,kind)
VALUES ('606','Achats non stockés de matières et fournitures','expense')
ON CONFLICT (code) DO NOTHING;

DO $account_606$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pcg2005_accounts
    WHERE code='606' AND kind='expense'
  ) THEN
    RAISE EXCEPTION 'PCG 2005 account 606 must exist as an expense account';
  END IF;
END;
$account_606$;

CREATE TABLE IF NOT EXISTS public.pcg2005_supplier_invoice_mappings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE RESTRICT,
  account_key text NOT NULL,
  pcg_code text NOT NULL REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 20),
  evidence_status text NOT NULL CHECK (evidence_status IN ('documented','record_only','pending')),
  requires_attachment boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,supplier_invoice_id,account_key)
);

ALTER TABLE public.pcg2005_supplier_invoice_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcg2005_supplier_invoice_mappings_read ON public.pcg2005_supplier_invoice_mappings;
CREATE POLICY pcg2005_supplier_invoice_mappings_read
  ON public.pcg2005_supplier_invoice_mappings FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));
REVOKE ALL ON public.pcg2005_supplier_invoice_mappings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pcg2005_supplier_invoice_mappings TO authenticated;

-- The production record identifies Computer Store invoice 2030 as a 30,000 MGA
-- mouse purchase. PCG 2005 classifies non-stocked, low-value supplies in 606.
-- No invoice attachment is present, so the mapping is explicitly marked record_only
-- and retains a missing-document flag rather than pretending the supporting invoice exists.
INSERT INTO public.pcg2005_supplier_invoice_mappings
  (organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment)
SELECT si.organization_id,si.id,'EXPENSE:SUPPLIER','606',
  'Computer Store invoice 2030: purchase of a mouse for MGA 30,000; small non-stocked equipment classified to PCG 2005 account 606. Original invoice attachment is absent and remains required for audit support.',
  'record_only',true
FROM public.supplier_invoices si
JOIN public.suppliers s ON s.id=si.supplier_id
JOIN public.journal_entries je
  ON je.source_id=si.id AND je.source_type='supplier_invoice'
JOIN public.journal_entry_lines jl
  ON jl.journal_entry_id=je.id AND jl.account_key='EXPENSE:SUPPLIER'
WHERE s.name='Computer Store'
  AND si.supplier_number='2030'
  AND si.magnisa_reference='DFO-00003'
  AND si.total=30000
  AND lower(trim(coalesce(si.notes,'')))='achat de souris'
  AND si.attachment_url IS NULL
ON CONFLICT (organization_id,supplier_invoice_id,account_key) DO NOTHING;

-- Computer Store invoice 2031 is also a low-value non-stocked supply purchase.
INSERT INTO public.pcg2005_supplier_invoice_mappings
  (organization_id,supplier_invoice_id,account_key,pcg_code,rationale,evidence_status,requires_attachment)
SELECT si.organization_id,si.id,'EXPENSE:SUPPLIER','606',
  'Computer Store invoice 2031: ink purchase for MGA 50,000; non-stocked consumable supplies classified to PCG 2005 account 606. Original invoice attachment is absent and remains required for audit support.',
  'record_only',true
FROM public.supplier_invoices si
JOIN public.suppliers s ON s.id=si.supplier_id
JOIN public.journal_entries je
  ON je.source_id=si.id AND je.source_type='supplier_invoice'
JOIN public.journal_entry_lines jl
  ON jl.journal_entry_id=je.id AND jl.account_key='EXPENSE:SUPPLIER'
WHERE s.name='Computer Store'
  AND si.supplier_number='2031'
  AND si.magnisa_reference='DFO-00004'
  AND si.total=50000
  AND lower(trim(coalesce(si.notes,'')))='achat d''encre'
  AND si.attachment_url IS NULL
ON CONFLICT (organization_id,supplier_invoice_id,account_key) DO NOTHING;

DO $source_mapping_assert$
BEGIN
  IF (
    SELECT count(*)
    FROM public.pcg2005_supplier_invoice_mappings sm
    JOIN public.supplier_invoices si ON si.id=sm.supplier_invoice_id
    JOIN public.suppliers s ON s.id=si.supplier_id
    WHERE s.name='Computer Store'
      AND (
        (si.supplier_number='2030' AND si.magnisa_reference='DFO-00003' AND si.total=30000
          AND lower(trim(coalesce(si.notes,'')))='achat de souris')
        OR
        (si.supplier_number='2031' AND si.magnisa_reference='DFO-00004' AND si.total=50000
          AND lower(trim(coalesce(si.notes,'')))='achat d''encre')
      )
      AND sm.account_key='EXPENSE:SUPPLIER'
      AND sm.pcg_code='606'
      AND sm.evidence_status='record_only'
      AND sm.requires_attachment
  ) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two source-specific PCG 606 mappings for Computer Store invoices 2030 and 2031';
  END IF;
END;
$source_mapping_assert$;

-- The two recorded computer acquisitions are classified provisionally as
-- tangible equipment. No fixed-asset register record or depreciation schedule
-- is fabricated while supplier invoices and in-service/useful-life details are absent.
CREATE TABLE IF NOT EXISTS public.pcg2005_expense_mappings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
  account_key text NOT NULL,
  pcg_code text NOT NULL REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 20),
  evidence_status text NOT NULL CHECK (evidence_status IN ('documented','record_only','pending')),
  requires_attachment boolean NOT NULL DEFAULT false,
  requires_asset_register boolean NOT NULL DEFAULT false,
  requires_useful_life boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,expense_id,account_key)
);

ALTER TABLE public.pcg2005_expense_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcg2005_expense_mappings_read ON public.pcg2005_expense_mappings;
CREATE POLICY pcg2005_expense_mappings_read
  ON public.pcg2005_expense_mappings FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'accounting.view'));
REVOKE ALL ON public.pcg2005_expense_mappings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pcg2005_expense_mappings TO authenticated;

INSERT INTO public.pcg2005_expense_mappings
  (organization_id,expense_id,account_key,pcg_code,rationale,evidence_status,
   requires_attachment,requires_asset_register,requires_useful_life)
SELECT e.organization_id,e.id,jl.account_key,'218',
  'Expense '||e.magnisa_reference||': recorded description identifies computer equipment intended for durable use; provisional PCG 218 classification. Supplier invoice, in-service date, useful life and fixed-asset register record are missing and must be completed before depreciation is finalized.',
  'record_only',true,true,true
FROM public.expenses e
JOIN public.journal_entries je ON je.source_id=e.id AND je.source_type='expense'
JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
WHERE (
    (e.magnisa_reference='DEP-00003' AND e.description='Ordinateur portable'
      AND e.category='Acquisition' AND e.amount=5000000 AND e.expense_date=DATE '2026-10-20'
      AND jl.account_key='EXPENSE:acquisition')
    OR
    (e.magnisa_reference='DEP-00004' AND e.description='Ordinateur'
      AND e.category='Achat de matériel informatique' AND e.amount=4000000 AND e.expense_date=DATE '2026-10-21'
      AND jl.account_key='EXPENSE:achat_de_mat_riel_informatique')
  )
  AND e.status='paid'
  AND e.expense_nature='expense'
  AND e.supplier_name IS NULL
  AND e.document_reference IS NULL
  AND e.useful_life_months IS NULL
ON CONFLICT (organization_id,expense_id,account_key) DO NOTHING;

DO $expense_mapping_assert$
BEGIN
  IF (
    SELECT count(*)
    FROM public.pcg2005_expense_mappings em
    JOIN public.expenses e ON e.id=em.expense_id
    WHERE (e.magnisa_reference,e.amount) IN (('DEP-00003',5000000),('DEP-00004',4000000))
      AND em.pcg_code='218'
      AND em.evidence_status='record_only'
      AND em.requires_attachment
      AND em.requires_asset_register
      AND em.requires_useful_life
  ) <> 2 THEN
    RAISE EXCEPTION 'Expected two provisional PCG 218 mappings for computer acquisitions DEP-00003 and DEP-00004';
  END IF;
END;
$expense_mapping_assert$;

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
      WHEN sm.pcg_code IS NOT NULL THEN sm.pcg_code
      WHEN em.pcg_code IS NOT NULL THEN em.pcg_code
      ELSE NULL::text
    END,
    CASE
      WHEN jl.account_key LIKE 'PCG:%' THEN SUBSTRING(jl.account_key FROM 5)
      ELSE NULL::text
    END,
    CASE
      WHEN jl.account_key LIKE 'TRANSIT:%' THEN '581'::text
      ELSE NULL::text
    END,
    CASE
      WHEN je.source_type='expense' AND jl.account_key='EXPENSE:transport'
        AND (je.description ILIKE '%déplacement%' OR je.description ILIKE '%deplacement%')
      THEN '625'::text
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
    WHEN sm.pcg_code IS NOT NULL OR em.pcg_code IS NOT NULL THEN 'manuel'
    WHEN jl.account_key LIKE 'PCG:%' THEN 'automatique'
    WHEN jl.account_key LIKE 'TRANSIT:%' THEN 'automatique'
    WHEN je.source_type='expense' AND jl.account_key='EXPENSE:transport'
      AND (je.description ILIKE '%déplacement%' OR je.description ILIKE '%deplacement%') THEN 'automatique'
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
  END AS mapping_status,
  COALESCE(sm.evidence_status,em.evidence_status) AS mapping_evidence_status,
  COALESCE(sm.rationale,em.rationale) AS mapping_rationale,
  (COALESCE(sm.requires_attachment,false) OR COALESCE(em.requires_attachment,false)) AS mapping_requires_attachment
FROM public.journal_entry_lines jl
JOIN public.journal_entries je
  ON je.id = jl.journal_entry_id
 AND je.organization_id = jl.organization_id
LEFT JOIN public.financial_accounts fa
  ON fa.id = jl.financial_account_id
 AND fa.organization_id = jl.organization_id
LEFT JOIN public.pcg2005_supplier_invoice_mappings sm
  ON je.source_type='supplier_invoice'
 AND sm.organization_id=jl.organization_id
 AND sm.supplier_invoice_id=je.source_id
 AND sm.account_key=jl.account_key
LEFT JOIN public.pcg2005_expense_mappings em
  ON je.source_type='expense'
 AND em.organization_id=jl.organization_id
 AND em.expense_id=je.source_id
 AND em.account_key=jl.account_key
LEFT JOIN public.pcg2005_account_mappings m
  ON m.organization_id = jl.organization_id
 AND m.legacy_account_key = jl.account_key
LEFT JOIN public.pcg2005_accounts mapped_pcg
  ON mapped_pcg.code = m.pcg_code
;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pcg2005_journal_lines
    WHERE source_type IN ('internal_transfer_debit','internal_transfer_credit')
      AND account_key LIKE 'TRANSIT:%'
      AND (pcg_code IS DISTINCT FROM '581' OR mapping_status <> 'automatique')
  ) THEN
    RAISE EXCEPTION 'PCG mapping regression: internal transfers must map to 581 automatically';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pcg2005_journal_lines l
    JOIN public.journal_entries je ON je.id=l.journal_entry_id
    WHERE l.source_type='expense' AND l.account_key='EXPENSE:transport'
      AND (je.description ILIKE '%déplacement%' OR je.description ILIKE '%deplacement%')
      AND (l.pcg_code IS DISTINCT FROM '625' OR l.mapping_status <> 'automatique')
  ) THEN
    RAISE EXCEPTION 'PCG mapping regression: documented travel expense must map to 625';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pcg2005_journal_lines
    WHERE (
      (source_type IN ('expense','supplier_invoice')
       AND account_key IN ('EXPENSE:transport','EXPENSE:acquisition','EXPENSE:achat_de_mat_riel_informatique','EXPENSE:SUPPLIER')
       AND NOT (source_type='expense' AND account_key='EXPENSE:transport'
         AND mapping_status='automatique' AND pcg_code='625'))
    )
    AND mapping_evidence_status IS NULL
    AND (pcg_code IS NOT NULL OR mapping_status <> 'a_mapper')
  ) THEN
    RAISE EXCEPTION 'PCG mapping regression: generic expenses and acquisitions must not map to balance-sheet accounts';
  END IF;
END $$;


REVOKE ALL ON public.pcg2005_journal_lines FROM anon;
GRANT SELECT ON public.pcg2005_journal_lines TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pcg2005_journal_lines FROM anon, authenticated;

DO $source_view_assert$
BEGIN
  IF (
    SELECT count(*) FROM public.pcg2005_journal_lines
    WHERE reference IN ('FOUR-2030','FOUR-2031')
      AND pcg_code='606'
      AND mapping_status='manuel'
      AND mapping_evidence_status='record_only'
      AND mapping_requires_attachment
  ) <> 2 THEN
    RAISE EXCEPTION 'Computer Store invoices 2030 and 2031 source-specific PCG 606 mappings are not visible in the journal projection';
  END IF;
END;
$source_view_assert$;

DO $expense_view_assert$
BEGIN
  IF (
    SELECT count(*) FROM public.pcg2005_journal_lines
    WHERE reference IN ('DEP-00003','DEP-00004')
      AND pcg_code='218'
      AND mapping_status='manuel'
      AND mapping_evidence_status='record_only'
      AND mapping_requires_attachment
  ) <> 2 THEN
    RAISE EXCEPTION 'Computer acquisitions DEP-00003 and DEP-00004 are not mapped provisionally to PCG 218 with evidence flags';
  END IF;
END;
$expense_view_assert$;

COMMENT ON TABLE public.pcg2005_expense_mappings IS
  'Source-specific provisional PCG mappings for expense records. Record-only mappings remain visibly blocked by missing invoices, fixed-asset register details or useful-life data.';

COMMENT ON VIEW public.pcg2005_journal_lines IS
  'PCG ledger projection preserving generic expense safeguards. Travel expenses are mapped to 625 only when the source expense description identifies a déplacement. Source-specific supplier invoice and expense overrides take precedence and retain evidence status; all other generic acquisition, IT equipment and supplier expense keys remain unmapped until their nature is evidenced.';

