-- Regression assertions for PCG 2005 VAT balance-sheet presentation rules.
DO $$
DECLARE
  v_asset public.pcg2005_balance_sheet_rules%rowtype;
  v_passif public.pcg2005_balance_sheet_passif_rules%rowtype;
BEGIN
  SELECT * INTO v_asset
  FROM public.pcg2005_balance_sheet_rules WHERE account_code='4456';
  IF NOT FOUND OR v_asset.section<>'current_assets'
     OR v_asset.line_key<>'tax_and_public_authority_balances'
     OR v_asset.normal_side<>'debit' OR v_asset.requires_maturity
     OR v_asset.contra_asset THEN
    RAISE EXCEPTION 'PCG 4456 must be a debit-normal current tax receivable';
  END IF;

  SELECT * INTO v_asset
  FROM public.pcg2005_balance_sheet_rules WHERE account_code='4457';
  IF NOT FOUND OR v_asset.section<>'current_liabilities'
     OR v_asset.line_key<>'tax_payables'
     OR v_asset.normal_side<>'credit' OR v_asset.requires_maturity
     OR v_asset.contra_asset THEN
    RAISE EXCEPTION 'PCG 4457 asset-catalogue rule must not present VAT collected as an asset';
  END IF;

  SELECT * INTO v_passif
  FROM public.pcg2005_balance_sheet_passif_rules WHERE account_code='4457';
  IF NOT FOUND OR v_passif.section<>'current_liabilities'
     OR v_passif.line_key<>'tax_payables'
     OR v_passif.normal_side<>'credit' OR v_passif.requires_maturity
     OR v_passif.contra_equity THEN
    RAISE EXCEPTION 'PCG 4457 must be a credit-normal current tax liability';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pcg2005_balance_sheet_mapping_gaps WHERE code IN ('4456','4457'))
     OR EXISTS (SELECT 1 FROM public.pcg2005_balance_sheet_passif_mapping_gaps WHERE code='4457') THEN
    RAISE EXCEPTION 'VAT balance-sheet account mapping gaps remain';
  END IF;
END $$;
