-- Complete the class-2 account families from the official Madagascar PCG 2005 recommended chart.
-- Source: Ministry of Economy and Finance / Conseil Supérieur de la Comptabilité, PCG 2005, pp. 146-148.
INSERT INTO public.pcg2005_accounts(code,label,kind) VALUES
 ('20','Immobilisations incorporelles','asset'),
 ('203','Frais de développement immobilisables','asset'),
 ('204','Logiciels informatiques et assimilés','asset'),
 ('205','Concessions et droits similaires, brevets, licences, marques','asset'),
 ('207','Fonds commercial','asset'),
 ('208','Autres immobilisations incorporelles','asset'),
 ('21','Immobilisations corporelles','asset'),
 ('211','Terrains','asset'),
 ('212','Agencements et aménagements de terrain','asset'),
 ('213','Constructions','asset'),
 ('215','Installations techniques','asset'),
 ('218','Autres immobilisations corporelles','asset'),
 ('22','Immobilisations mises en concession','asset'),
 ('221','Terrains en concession','asset'),
 ('222','Agencements et aménagements de terrain en concession','asset'),
 ('223','Constructions en concession','asset'),
 ('225','Installations techniques en concession','asset'),
 ('228','Autres immobilisations corporelles en concession','asset'),
 ('229','Droits du concédant','liability'),
 ('23','Immobilisations en cours','asset'),
 ('232','Immobilisations corporelles en cours','asset'),
 ('237','Immobilisations incorporelles en cours','asset'),
 ('238','Avances et acomptes versés sur commandes d’immobilisations','asset'),
 ('26','Participations et créances rattachées à des participations','asset'),
 ('261','Titres de participation','asset'),
 ('262','Autres formes de participations','asset'),
 ('265','Titres de participation évalués par équivalence','asset'),
 ('266','Créances rattachées à des participations groupe','asset'),
 ('267','Créances rattachées à des participations hors groupe','asset'),
 ('268','Créances rattachées à des sociétés en participation','asset'),
 ('269','Versements restant à effectuer sur titres de participation non libérés','asset'),
 ('27','Autres immobilisations financières','asset'),
 ('271','Titres immobilisés autres que les titres immobilisés de l’activité de portefeuille','asset'),
 ('272','Titres représentatifs de droit de créance','asset'),
 ('273','Titres immobilisés de l’activité de portefeuille','asset'),
 ('274','Prêts','asset'),
 ('275','Dépôts et cautionnements versés','asset'),
 ('276','Autres créances immobilisées','asset'),
 ('277','Actions propres ou parts propres','asset'),
 ('279','Versements restant à effectuer sur titres immobilisés non libérés','asset'),
 ('28','Amortissements des immobilisations','asset'),
 ('280','Amortissements des immobilisations incorporelles','asset'),
 ('281','Amortissements des immobilisations corporelles','asset'),
 ('282','Amortissements des immobilisations mises en concession','asset'),
 ('29','Pertes de valeur sur immobilisations','asset'),
 ('290','Pertes de valeur sur immobilisations incorporelles','asset'),
 ('291','Pertes de valeur sur immobilisations corporelles','asset'),
 ('292','Pertes de valeur sur immobilisations mises en concession','asset'),
 ('293','Pertes de valeur sur immobilisations en cours','asset'),
 ('296','Pertes de valeur sur participations et créances rattachées à des participations','asset'),
 ('297','Pertes de valeur sur autres immobilisations financières','asset'),
 ('72','Production immobilisée','income'),
 ('404','Fournisseurs d’immobilisations','liability'),
 ('462','Créances sur cessions d’immobilisations','asset'),
 ('652','Moins-values sur cessions d’actifs non courants','expense'),
 ('681','Dotations aux amortissements, provisions et pertes de valeur des actifs non courants','expense'),
 ('752','Plus-values sur cessions d’actifs non courants','income'),
 ('781','Reprises sur provisions et pertes de valeur des actifs non courants','income')
ON CONFLICT (code) DO UPDATE SET label=excluded.label,kind=excluded.kind;

-- These codes were introduced by the first lifecycle draft but are not the PCG 2005 Madagascar accounts.
-- Remove only if no journal line or organization mapping references them.
DELETE FROM public.pcg2005_accounts a
WHERE a.code IN ('675','775','6816','7816')
  AND NOT EXISTS (SELECT 1 FROM public.journal_entry_lines l WHERE l.account_key='PCG:'||a.code)
  AND NOT EXISTS (SELECT 1 FROM public.pcg2005_account_mappings m WHERE m.pcg_code=a.code);

-- Align account fields with the official PCG class families; null remains allowed for legacy assets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fixed_assets_pcg_class_families_chk') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_pcg_class_families_chk CHECK (
      (pcg_asset_account_code IS NULL OR (pcg_asset_account_code ~ '^(20|21|22|23|26|27)[0-9]{0,4}
      AND (pcg_acquisition_counterpart_account_code IS NULL OR pcg_acquisition_counterpart_account_code ~ '^(10|4|5|72)[0-9]{0,4}
      AND (pcg_accumulated_depreciation_account_code IS NULL OR pcg_accumulated_depreciation_account_code ~ '^28[0-9]{0,4}$')
      AND (pcg_depreciation_expense_account_code IS NULL OR pcg_depreciation_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_account_code IS NULL OR pcg_impairment_account_code ~ '^29[0-9]{0,4}$')
      AND (pcg_impairment_expense_account_code IS NULL OR pcg_impairment_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_reversal_income_account_code IS NULL OR pcg_impairment_reversal_income_account_code ~ '^78[0-9]{0,4}$')
      AND (pcg_disposal_receivable_account_code IS NULL OR pcg_disposal_receivable_account_code ~ '^46[0-9]{0,4}$')
      AND (pcg_disposal_expense_account_code IS NULL OR pcg_disposal_expense_account_code ~ '^65[0-9]{0,4}$')
      AND (pcg_disposal_income_account_code IS NULL OR pcg_disposal_income_account_code ~ '^75[0-9]{0,4}$')
    );
  END IF;
END $$;

COMMENT ON TABLE public.pcg2005_accounts IS
  'PCG 2005 Madagascar account catalogue. Class 2 base accounts and relevant posting accounts are aligned to the official MEF/CSC recommended chart; permitted subdivisions remain entity-specific.';
 AND pcg_asset_account_code !~ '^229'))
      AND (pcg_acquisition_counterpart_account_code IS NULL OR pcg_acquisition_counterpart_account_code ~ '^[45][0-9]{0,5}$')
      AND (pcg_accumulated_depreciation_account_code IS NULL OR pcg_accumulated_depreciation_account_code ~ '^28[0-9]{0,4}$')
      AND (pcg_depreciation_expense_account_code IS NULL OR pcg_depreciation_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_account_code IS NULL OR pcg_impairment_account_code ~ '^29[0-9]{0,4}$')
      AND (pcg_impairment_expense_account_code IS NULL OR pcg_impairment_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_reversal_income_account_code IS NULL OR pcg_impairment_reversal_income_account_code ~ '^78[0-9]{0,4}$')
      AND (pcg_disposal_receivable_account_code IS NULL OR pcg_disposal_receivable_account_code ~ '^46[0-9]{0,4}$')
      AND (pcg_disposal_expense_account_code IS NULL OR pcg_disposal_expense_account_code ~ '^65[0-9]{0,4}$')
      AND (pcg_disposal_income_account_code IS NULL OR pcg_disposal_income_account_code ~ '^75[0-9]{0,4}$')
    );
  END IF;
END $$;

COMMENT ON TABLE public.pcg2005_accounts IS
  'PCG 2005 Madagascar account catalogue. Class 2 base accounts and relevant posting accounts are aligned to the official MEF/CSC recommended chart; permitted subdivisions remain entity-specific.';
)
      AND (pcg_accumulated_depreciation_account_code IS NULL OR pcg_accumulated_depreciation_account_code ~ '^28[0-9]{0,4}$')
      AND (pcg_depreciation_expense_account_code IS NULL OR pcg_depreciation_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_account_code IS NULL OR pcg_impairment_account_code ~ '^29[0-9]{0,4}$')
      AND (pcg_impairment_expense_account_code IS NULL OR pcg_impairment_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_reversal_income_account_code IS NULL OR pcg_impairment_reversal_income_account_code ~ '^78[0-9]{0,4}$')
      AND (pcg_disposal_receivable_account_code IS NULL OR pcg_disposal_receivable_account_code ~ '^46[0-9]{0,4}$')
      AND (pcg_disposal_expense_account_code IS NULL OR pcg_disposal_expense_account_code ~ '^65[0-9]{0,4}$')
      AND (pcg_disposal_income_account_code IS NULL OR pcg_disposal_income_account_code ~ '^75[0-9]{0,4}$')
    );
  END IF;
END $$;

COMMENT ON TABLE public.pcg2005_accounts IS
  'PCG 2005 Madagascar account catalogue. Class 2 base accounts and relevant posting accounts are aligned to the official MEF/CSC recommended chart; permitted subdivisions remain entity-specific.';
 AND pcg_asset_account_code !~ '^229'))
      AND (pcg_acquisition_counterpart_account_code IS NULL OR pcg_acquisition_counterpart_account_code ~ '^[45][0-9]{0,5}$')
      AND (pcg_accumulated_depreciation_account_code IS NULL OR pcg_accumulated_depreciation_account_code ~ '^28[0-9]{0,4}$')
      AND (pcg_depreciation_expense_account_code IS NULL OR pcg_depreciation_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_account_code IS NULL OR pcg_impairment_account_code ~ '^29[0-9]{0,4}$')
      AND (pcg_impairment_expense_account_code IS NULL OR pcg_impairment_expense_account_code ~ '^68[0-9]{0,4}$')
      AND (pcg_impairment_reversal_income_account_code IS NULL OR pcg_impairment_reversal_income_account_code ~ '^78[0-9]{0,4}$')
      AND (pcg_disposal_receivable_account_code IS NULL OR pcg_disposal_receivable_account_code ~ '^46[0-9]{0,4}$')
      AND (pcg_disposal_expense_account_code IS NULL OR pcg_disposal_expense_account_code ~ '^65[0-9]{0,4}$')
      AND (pcg_disposal_income_account_code IS NULL OR pcg_disposal_income_account_code ~ '^75[0-9]{0,4}$')
    );
  END IF;
END $$;

COMMENT ON TABLE public.pcg2005_accounts IS
  'PCG 2005 Madagascar account catalogue. Class 2 base accounts and relevant posting accounts are aligned to the official MEF/CSC recommended chart; permitted subdivisions remain entity-specific.';
