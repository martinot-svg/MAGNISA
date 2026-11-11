-- A supplier invoice can be reclassified from an expense to one registered fixed asset.
-- The original AP invoice remains intact; a balanced Dr fixed asset / Cr expense journal
-- transfers the capitalizable cost without duplicating the supplier payable.
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS accounting_treatment text NOT NULL DEFAULT 'expense';
ALTER TABLE public.supplier_invoices
  DROP CONSTRAINT IF EXISTS supplier_invoices_accounting_treatment_check;
ALTER TABLE public.supplier_invoices
  ADD CONSTRAINT supplier_invoices_accounting_treatment_check
    CHECK(accounting_treatment IN ('expense','fixed_asset'));

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS source_supplier_invoice_id uuid
    REFERENCES public.supplier_invoices(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_source_supplier_invoice_uidx
  ON public.fixed_assets(organization_id,source_supplier_invoice_id)
  WHERE source_supplier_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.validate_fixed_asset_supplier_invoice_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
BEGIN
  IF NEW.source_supplier_invoice_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.supplier_invoices si
    WHERE si.id=NEW.source_supplier_invoice_id AND si.organization_id=NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'La facture fournisseur liée à cette immobilisation appartient à une autre organisation ou est introuvable.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS fixed_assets_supplier_invoice_link_guard ON public.fixed_assets;
CREATE TRIGGER fixed_assets_supplier_invoice_link_guard
BEFORE INSERT OR UPDATE OF source_supplier_invoice_id,organization_id
ON public.fixed_assets
FOR EACH ROW EXECUTE FUNCTION private.validate_fixed_asset_supplier_invoice_link();

CREATE OR REPLACE FUNCTION public.magnisa_reclassify_supplier_invoice_to_fixed_asset(
  p_org uuid,p_supplier_invoice uuid,p_asset uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private,auth
AS $function$
DECLARE
  v_invoice public.supplier_invoices%rowtype;
  v_asset public.fixed_assets%rowtype;
  v_supplier_name text;
  v_invoice_journal uuid;
  v_journal uuid;
  v_capitalized numeric(18,2);
  v_expense_kind text;
  v_asset_kind text;
  v_accumulated_kind text;
  v_depreciation_kind text;
  v_match_count integer;
  v_matched_quantity numeric;
  v_lines jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org);
  PERFORM public.assert_org_permission(p_org,'accounting.manage');
  SELECT * INTO v_invoice FROM public.supplier_invoices
  WHERE id=p_supplier_invoice AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_invoice.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Facture fournisseur absente, brouillon ou annulée.';
  END IF;
  SELECT * INTO v_asset FROM public.fixed_assets
  WHERE id=p_asset AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR v_asset.status<>'active' OR v_asset.legacy_accounting_origin THEN
    RAISE EXCEPTION 'Fiche immobilisation introuvable ou non comptabilisable.';
  END IF;

  IF v_asset.source_supplier_invoice_id=p_supplier_invoice
     AND v_asset.acquisition_journal_entry_id IS NOT NULL
     AND v_invoice.accounting_treatment='fixed_asset' THEN
    RETURN v_asset.acquisition_journal_entry_id;
  END IF;
  IF v_invoice.accounting_treatment<>'expense' OR v_asset.source_supplier_invoice_id IS NOT NULL
     OR v_asset.acquisition_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'La facture ou l’immobilisation est déjà rattachée à une autre opération comptable.';
  END IF;
  SELECT name INTO v_supplier_name FROM public.suppliers
  WHERE id=v_invoice.supplier_id AND organization_id=p_org;
  IF v_asset.supplier_name IS NULL OR lower(trim(v_asset.supplier_name))<>lower(trim(coalesce(v_supplier_name,'')))
     OR v_asset.invoice_reference IS NULL OR trim(v_asset.invoice_reference)<>v_invoice.supplier_number THEN
    RAISE EXCEPTION 'Le fournisseur et le numéro de facture de la fiche immobilisation doivent correspondre exactement à la facture sélectionnée.';
  END IF;
  IF v_asset.acquisition_date<>v_invoice.invoice_date THEN
    RAISE EXCEPTION 'La date d’acquisition de la fiche doit correspondre à la date de facture.';
  END IF;
  IF v_invoice.reconciliation_scope='goods_procurement' THEN
    SELECT count(*),COALESCE(sum(sml.quantity_invoiced),0)
    INTO v_match_count,v_matched_quantity
    FROM public.supplier_invoice_matches sim
    JOIN public.supplier_invoice_match_lines sml
      ON sml.match_id=sim.id AND sml.organization_id=sim.organization_id
    WHERE sim.organization_id=p_org AND sim.supplier_invoice_id=p_supplier_invoice;
    IF v_match_count<>1 OR v_matched_quantity<>1 OR EXISTS(
      SELECT 1
      FROM public.supplier_invoice_matches sim
      JOIN public.supplier_invoice_match_lines sml
        ON sml.match_id=sim.id AND sml.organization_id=sim.organization_id
      JOIN public.goods_receipt_lines grl
        ON grl.id=sml.goods_receipt_line_id AND grl.organization_id=sml.organization_id
      JOIN public.purchase_order_lines pol
        ON pol.id=grl.purchase_order_line_id AND pol.organization_id=grl.organization_id
      JOIN public.catalog_items ci
        ON ci.id=pol.item_id AND ci.organization_id=pol.organization_id
      WHERE sim.organization_id=p_org AND sim.supplier_invoice_id=p_supplier_invoice
        AND (pol.purchase_purpose<>'company_use' OR ci.item_kind<>'equipment' OR ci.tracking_mode<>'none')
    ) THEN
      RAISE EXCEPTION 'Une facture d’achat de biens ne peut être capitalisée ici que si elle rapproche exactement un équipement non suivi en stock, pour une unité.';
    END IF;
  END IF;
  IF v_asset.directly_attributable_cost<>0 THEN
    RAISE EXCEPTION 'Les coûts directement attribuables doivent être justifiés et rattachés séparément avant cette reclassification.';
  END IF;
  v_capitalized:=round(v_invoice.subtotal+
    CASE WHEN v_invoice.tax_treatment='nonrecoverable' THEN v_invoice.tax_total ELSE 0 END,2);
  IF v_capitalized<=0 OR v_asset.acquisition_cost<>v_capitalized THEN
    RAISE EXCEPTION 'Le coût immobilisé doit être égal au HT augmenté uniquement de la TVA non déductible.';
  END IF;
  IF v_invoice.expense_account_code IS NULL THEN
    RAISE EXCEPTION 'La facture doit d’abord être imputée à un compte de charge PCG.';
  END IF;
  SELECT kind INTO v_expense_kind FROM public.pcg2005_accounts WHERE code=v_invoice.expense_account_code;
  SELECT kind INTO v_asset_kind FROM public.pcg2005_accounts WHERE code=v_asset.pcg_asset_account_code;
  IF v_expense_kind IS DISTINCT FROM 'expense' OR v_asset_kind IS DISTINCT FROM 'asset' THEN
    RAISE EXCEPTION 'Le compte de charge source ou le compte d’immobilisation PCG est invalide.';
  END IF;
  IF v_asset.depreciation_method='straight_line' THEN
    IF v_asset.useful_life_months IS NULL OR v_asset.in_service_date IS NULL
       OR v_asset.pcg_accumulated_depreciation_account_code IS NULL
       OR v_asset.pcg_depreciation_expense_account_code IS NULL THEN
      RAISE EXCEPTION 'Une immobilisation amortissable exige une durée, une date de mise en service et les comptes 28 et 68.';
    END IF;
    SELECT kind INTO v_accumulated_kind FROM public.pcg2005_accounts
      WHERE code=v_asset.pcg_accumulated_depreciation_account_code;
    SELECT kind INTO v_depreciation_kind FROM public.pcg2005_accounts
      WHERE code=v_asset.pcg_depreciation_expense_account_code;
    IF v_accumulated_kind IS DISTINCT FROM 'asset' OR v_depreciation_kind IS DISTINCT FROM 'expense' THEN
      RAISE EXCEPTION 'Les comptes 28 et 68 de l’immobilisation sont invalides.';
    END IF;
  END IF;

  SELECT id INTO v_invoice_journal FROM public.journal_entries
  WHERE organization_id=p_org AND source_type='supplier_invoice'
    AND source_id=p_supplier_invoice AND status='posted'
  ORDER BY created_at LIMIT 1;
  IF v_invoice_journal IS NULL THEN
    RAISE EXCEPTION 'La facture fournisseur doit posséder une écriture validée avant sa reclassification.';
  END IF;
  PERFORM public.magnisa_assert_accounting_period_open(p_org,v_invoice.invoice_date);
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_kind','pcg','pcg_code',v_asset.pcg_asset_account_code,'debit',v_capitalized,'credit',0),
    jsonb_build_object('account_kind','pcg','pcg_code',v_invoice.expense_account_code,'debit',0,'credit',v_capitalized)
  );
  v_journal:=public.magnisa_post_journal(
    p_org,v_invoice.invoice_date,
    'IMMO-FOUR-'||upper(substr(replace(v_asset.id::text,'-',''),1,12)),
    'Reclassement en immobilisation — facture fournisseur '||v_invoice.supplier_number,
    'supplier_invoice_fixed_asset_reclass',v_asset.id,v_lines
  );
  UPDATE public.fixed_assets
  SET source_supplier_invoice_id=p_supplier_invoice,
      acquisition_journal_entry_id=v_journal,
      updated_at=now()
  WHERE id=p_asset AND organization_id=p_org;
  UPDATE public.supplier_invoices
  SET accounting_treatment='fixed_asset'
  WHERE id=p_supplier_invoice AND organization_id=p_org;
  PERFORM public.audit_event(p_org,'supplier_invoice.reclassified_as_fixed_asset','supplier_invoice',p_supplier_invoice,NULL,
    jsonb_build_object('fixed_asset_id',p_asset,'invoice_journal_id',v_invoice_journal,
      'reclassification_journal_id',v_journal,'asset_account_code',v_asset.pcg_asset_account_code,
      'reversed_expense_account_code',v_invoice.expense_account_code,'capitalized_amount',v_capitalized));
  RETURN v_journal;
END;
$function$;

REVOKE ALL ON FUNCTION public.magnisa_reclassify_supplier_invoice_to_fixed_asset(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.magnisa_reclassify_supplier_invoice_to_fixed_asset(uuid,uuid,uuid) TO authenticated;
