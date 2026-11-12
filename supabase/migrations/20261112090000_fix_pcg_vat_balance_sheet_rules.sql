-- Complete the PCG 2005 balance-sheet presentation for VAT subaccounts.
-- 4456 is recoverable VAT (current asset); 4457 is collected VAT (current liability).
-- The 4457 asset-side rule is deliberately retained as a non-asset section so the
-- asset catalogue remains complete without presenting the same balance as an asset.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pcg2005_accounts
    WHERE code='4456' AND kind='asset'
  ) THEN
    RAISE EXCEPTION 'PCG 4456 must exist as a recoverable-VAT asset account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pcg2005_accounts
    WHERE code='4457' AND kind='liability'
  ) THEN
    RAISE EXCEPTION 'PCG 4457 must exist as a collected-VAT liability account';
  END IF;
END $$;

INSERT INTO public.pcg2005_balance_sheet_rules
  (account_code,section,line_key,normal_side,requires_maturity,contra_asset,source_reference)
VALUES
  ('4456','current_assets','tax_and_public_authority_balances','debit',false,false,
   'PCG 2005, compte 4456 - TVA déductible'),
  ('4457','current_liabilities','tax_payables','credit',false,false,
   'PCG 2005, compte 4457 - TVA collectée')
ON CONFLICT (account_code) DO UPDATE SET
  section=EXCLUDED.section,
  line_key=EXCLUDED.line_key,
  normal_side=EXCLUDED.normal_side,
  requires_maturity=EXCLUDED.requires_maturity,
  contra_asset=EXCLUDED.contra_asset,
  source_reference=EXCLUDED.source_reference;

INSERT INTO public.pcg2005_balance_sheet_passif_rules
  (account_code,section,line_key,normal_side,requires_maturity,contra_equity,source_reference)
VALUES
  ('4457','current_liabilities','tax_payables','credit',false,false,
   'PCG 2005, compte 4457 - TVA collectée')
ON CONFLICT (account_code) DO UPDATE SET
  section=EXCLUDED.section,
  line_key=EXCLUDED.line_key,
  normal_side=EXCLUDED.normal_side,
  requires_maturity=EXCLUDED.requires_maturity,
  contra_equity=EXCLUDED.contra_equity,
  source_reference=EXCLUDED.source_reference;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.pcg2005_balance_sheet_mapping_gaps
    WHERE code IN ('4456','4457')
  ) THEN
    RAISE EXCEPTION 'PCG 4456/4457 remain missing from the asset-side presentation catalogue';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pcg2005_balance_sheet_passif_mapping_gaps
    WHERE code='4457'
  ) THEN
    RAISE EXCEPTION 'PCG 4457 remains missing from the passif presentation catalogue';
  END IF;
END $$;
