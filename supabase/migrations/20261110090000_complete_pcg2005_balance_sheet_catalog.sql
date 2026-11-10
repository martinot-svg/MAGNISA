-- PCG 2005 Madagascar: complete the recommended balance-sheet account families
-- and attach explicit presentation metadata. Additive only; no journal entry is changed.
-- Official source: PCG 2005, Annexe I, recommended chart, pp. 144-151;
-- Articles 131-3 to 131-5 and 220-2 to 220-5.
-- https://www.mef.gov.mg/csc/ckfinder/userfiles/files/plan-comptable-general-2005.pdf

INSERT INTO public.pcg2005_accounts(code,label,kind) VALUES
 ('104','Primes liées au capital social','equity'),
 ('105','Écart d’évaluation','equity'),
 ('106','Réserves','equity'),
 ('107','Écart d’équivalence','equity'),
 ('108','Compte de l’exploitant','equity'),
 ('109','Actionnaires, capital souscrit non appelé','equity'),
 ('131','Subventions d’équipement','liability'),
 ('132','Autres subventions d’investissement','liability'),
 ('133','Impôts différés actif','asset'),
 ('134','Impôts différés passif','liability'),
 ('138','Autres produits et charges différés','liability'),
 ('153','Provisions pour pensions et obligations similaires','liability'),
 ('155','Provisions pour impôts','liability'),
 ('156','Provisions pour renouvellement des immobilisations (concession)','liability'),
 ('158','Autres provisions pour charges - passifs non courants','liability'),
 ('161','Emprunts obligataires convertibles','liability'),
 ('163','Autres emprunts obligataires','liability'),
 ('165','Dépôts et cautionnements reçus','liability'),
 ('167','Dettes sur contrat de location-financement','liability'),
 ('169','Primes de remboursement des obligations','liability'),
 ('171','Dettes rattachées à des participations groupe','liability'),
 ('172','Dettes rattachées à des participations hors groupe','liability'),
 ('173','Dettes rattachées à des sociétés en participation','liability'),
 ('178','Autres dettes rattachées à des participations','liability'),
 ('181','Comptes de liaison entre établissements','clearing'),
 ('188','Comptes de liaison entre sociétés en participation','clearing'),
 ('31','Matières premières et fournitures','asset'),
 ('32','Autres approvisionnements','asset'),
 ('321','Matières consommables','asset'),
 ('322','Fournitures consommables','asset'),
 ('326','Emballages','asset'),
 ('33','En cours de production de biens','asset'),
 ('331','Produits en cours','asset'),
 ('335','Travaux en cours','asset'),
 ('34','En cours de production de services','asset'),
 ('341','Études en cours','asset'),
 ('35','Stocks de produits','asset'),
 ('351','Produits intermédiaires','asset'),
 ('355','Produits finis','asset'),
 ('358','Produits résiduels ou matières de récupération','asset'),
 ('37','Stocks de marchandises','asset'),
 ('38','Stocks à l’extérieur','asset'),
 ('39','Pertes de valeur sur stocks et en-cours','asset'),
 ('391','Pertes de valeur matières premières et fournitures','asset'),
 ('392','Pertes de valeur autres approvisionnements','asset'),
 ('393','Pertes de valeur en-cours de production de biens','asset'),
 ('394','Pertes de valeur en-cours de production de services','asset'),
 ('395','Pertes de valeur stocks de produits','asset'),
 ('397','Pertes de valeur stocks de marchandises','asset'),
 ('398','Pertes de valeur stocks à l’extérieur','asset'),
 ('403','Fournisseurs effets à payer','liability'),
 ('408','Fournisseurs factures non parvenues','liability'),
 ('416','Clients douteux','asset'),
 ('417','Créances sur travaux non encore facturables','asset'),
 ('418','Clients - produits non encore facturés','asset'),
 ('422','Fonds sociaux - œuvres sociales','liability'),
 ('426','Personnel, dépôts reçus','liability'),
 ('427','Personnel, oppositions','liability'),
 ('428','Personnel, charges à payer et produits à recevoir','clearing'),
 ('432','Organismes sociaux B','liability'),
 ('438','Organismes sociaux, charges à payer','liability'),
 ('441','État, subventions à recevoir','asset'),
 ('443','Opérations particulières avec l’État et autres organismes publics','clearing'),
 ('447','Autres impôts, taxes et versements assimilés','liability'),
 ('448','État, charges à payer et produits à recevoir','clearing'),
 ('451','Opérations Groupe','clearing'),
 ('456','Associés, opérations sur le capital','clearing'),
 ('457','Associés, dividendes à payer','liability'),
 ('458','Associés, opérations faites en commun ou en groupement','clearing'),
 ('464','Dettes sur acquisitions de valeurs mobilières de placement','liability'),
 ('465','Créances sur cessions de valeurs mobilières de placement','asset'),
 ('468','Divers charges à payer ou produits à recevoir','clearing'),
 ('481','Provisions - passifs courants','liability'),
 ('486','Charges constatées d’avance','asset'),
 ('487','Produits constatés d’avance','liability'),
 ('491','Pertes de valeur sur comptes de clients','asset'),
 ('495','Pertes de valeur sur comptes du groupe et des associés','asset'),
 ('496','Pertes de valeur sur comptes de débiteurs divers','asset'),
 ('501','Parts dans des entreprises liées','asset'),
 ('503','Actions','asset'),
 ('504','Autres titres conférant un droit de propriété','asset'),
 ('505','Obligations et bons émis par la société et rachetés par elle','asset'),
 ('506','Obligations','asset'),
 ('507','Bons du Trésor et bons de caisse à court terme','asset'),
 ('508','Autres valeurs mobilières de placement et créances assimilées','asset'),
 ('509','Versements restant à effectuer sur VMP non libérées','asset'),
 ('515','Caisse du Trésor Public et établissements publics','asset'),
 ('518','Intérêts courus','asset'),
 ('516','Échéances à moins d’un an des dettes à long terme','liability'),
 ('519','Concours bancaires courants','liability'),
 ('52','Instruments de trésorerie','asset'),
 ('54','Régies d’avances et accréditifs','asset'),
 ('588','Autres virements internes','clearing'),
 ('591','Pertes de valeur sur valeurs en banque et établissements financiers','asset'),
 ('594','Pertes de valeur sur régies d’avances et accréditifs','asset')
ON CONFLICT (code) DO NOTHING;

-- Split receivable/payable subaccounts used by the official PCG 2005 balance-sheet model.
INSERT INTO public.pcg2005_accounts(code,label,kind) VALUES
 ('4286','Personnel, charges à payer','liability'),
 ('4287','Personnel, produits à recevoir','asset'),
 ('4486','État, charges à payer','liability'),
 ('4487','État, produits à recevoir','asset'),
 ('4686','Divers charges à payer','liability'),
 ('4687','Divers produits à recevoir','asset')
ON CONFLICT (code) DO NOTHING;

-- These PCG accounts can carry either a debit asset balance or a credit liability balance.
UPDATE public.pcg2005_accounts
SET kind='clearing'
WHERE code IN ('422','442','443','445','451','456','458','467')
  AND kind IS DISTINCT FROM 'clearing';

CREATE TABLE IF NOT EXISTS public.pcg2005_balance_sheet_rules (
  account_code text PRIMARY KEY REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  section text NOT NULL CHECK (section IN (
    'non_current_assets','current_assets','non_current_liabilities',
    'current_liabilities','equity','clearing','review'
  )),
  line_key text NOT NULL,
  normal_side text NOT NULL CHECK (normal_side IN ('debit','credit','both')),
  requires_maturity boolean NOT NULL DEFAULT false,
  contra_asset boolean NOT NULL DEFAULT false,
  source_reference text NOT NULL DEFAULT 'PCG 2005, Annexe I and articles 131/220'
);

ALTER TABLE public.pcg2005_balance_sheet_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcg2005_balance_sheet_rules_read ON public.pcg2005_balance_sheet_rules;
CREATE POLICY pcg2005_balance_sheet_rules_read
  ON public.pcg2005_balance_sheet_rules FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pcg2005_balance_sheet_rules FROM PUBLIC, anon;
GRANT SELECT ON public.pcg2005_balance_sheet_rules TO authenticated;

-- Class 1: equity and liabilities. Account 109 is a deduction from equity.
INSERT INTO public.pcg2005_balance_sheet_rules(account_code,section,line_key,normal_side)
SELECT code,
  CASE WHEN code IN ('101','104','105','106','107','108','109','110','119','120','129') THEN 'equity'
       WHEN code='133' THEN 'non_current_assets'
       WHEN code IN ('181','188') THEN 'clearing'
       ELSE 'non_current_liabilities' END,
  CASE WHEN code='109' THEN 'unpaid_subscribed_capital'
       WHEN code IN ('131','132') THEN 'investment_grants'
    WHEN code='229' THEN 'concession_obligations'
       WHEN code IN ('133') THEN 'deferred_tax_asset'
       WHEN code IN ('134') THEN 'deferred_tax_liability'
       WHEN code IN ('153','155','156','158') THEN 'non_current_provisions'
       WHEN code IN ('161','163','164','165','167','168','169') THEN 'non_current_borrowings'
       WHEN code IN ('171','172','173','178') THEN 'participation_debts'
       WHEN code IN ('181','188') THEN 'inter_entity_clearing'
       ELSE 'equity_components' END,
  CASE WHEN code='109' THEN 'debit'
       WHEN code IN ('101','104','105','106','107','108','110','120','131','132','134','138','153','155','156','158','161','163','164','165','167','168','171','172','173','178') THEN 'credit'
       WHEN code IN ('119','129','133','169') THEN 'debit'
       ELSE 'both' END
FROM public.pcg2005_accounts
WHERE code ~ '^(10[1-9]|11[09]|12[09]|13[1-8]|15[3-8]|16[1-9]|17[1-8]|18[18])$'
ON CONFLICT (account_code) DO NOTHING;

-- Class 2: long-term assets; accumulated depreciation and impairment are contra-assets.
INSERT INTO public.pcg2005_balance_sheet_rules(account_code,section,line_key,normal_side,contra_asset)
SELECT code,CASE WHEN code='229' THEN 'non_current_liabilities' ELSE 'non_current_assets' END,
  CASE WHEN code='229' THEN 'rights_of_grantor'
       WHEN code ~ '^20' THEN 'intangible_assets_gross'
       WHEN code ~ '^21' THEN 'tangible_assets_gross'
       WHEN code ~ '^22' THEN 'concession_assets_gross'
       WHEN code ~ '^23' THEN 'assets_in_progress'
       WHEN code='269' THEN 'unpaid_participations'
       WHEN code='279' THEN 'unpaid_other_financial_assets'
       WHEN code ~ '^26' THEN 'financial_participations'
       WHEN code ~ '^27' THEN 'other_financial_assets'
       WHEN code ~ '^28' THEN 'accumulated_depreciation'
       WHEN code ~ '^29' THEN 'non_current_impairment'
       ELSE 'unclassified_non_current_asset' END,
  CASE WHEN code='229' OR code ~ '^(28|29)' OR code IN ('269','279') THEN 'credit' ELSE 'debit' END,
  code ~ '^(28|29)' OR code IN ('269','279')
FROM public.pcg2005_accounts
WHERE code ~ '^(20|21|22|23|26|27|28|29)'
ON CONFLICT (account_code) DO NOTHING;

-- Class 3: inventories and their valuation allowances.
INSERT INTO public.pcg2005_balance_sheet_rules(account_code,section,line_key,normal_side,contra_asset)
SELECT code,'current_assets',
  CASE WHEN code ~ '^39' THEN 'inventory_impairment' ELSE 'inventories_gross' END,
  CASE WHEN code ~ '^39' THEN 'credit' ELSE 'debit' END,
  code ~ '^39'
FROM public.pcg2005_accounts
WHERE code ~ '^(31|32|33|34|35|37|38|39)'
ON CONFLICT (account_code) DO NOTHING;

-- Class 4: third-party accounts. Maturity is mandatory; mixed/clearing accounts
-- remain blocked until their debit/credit nature and supporting detail are reconciled.
INSERT INTO public.pcg2005_balance_sheet_rules(account_code,section,line_key,normal_side,requires_maturity,contra_asset)
SELECT code,
  CASE
    WHEN code IN ('409','411','413','416','417','418','422','425','4287','441','442','443','445','4487','451','456','458','462','465','467','4687','486') THEN 'current_assets'
    WHEN code IN ('401','403','404','405','408','419','421','426','427','431','432','438','444','447','457','481','487','4286','4486','4686') THEN 'current_liabilities'
    WHEN code ~ '^49' THEN 'current_assets'
    WHEN code ~ '^47' OR code IN ('428','448','468','455') THEN 'review'
    ELSE 'review'
  END,
  CASE
    WHEN code IN ('411','413','416','417','418','419') THEN 'trade_receivables'
    WHEN code IN ('409','425') THEN 'advances_and_deposits'
    WHEN code IN ('441','442','443','444','445','447','448','4486','4487') THEN 'tax_and_public_authority_balances'
    WHEN code IN ('422','4286','4287','462','464','465','451','456','458','467','468','4686','4687') THEN 'other_receivables_and_payables'
    WHEN code IN ('486','487') THEN 'accruals_and_deferred_income'
    WHEN code ~ '^49' THEN 'receivables_impairment'
    WHEN code ~ '^47' THEN 'suspense_and_transitory'
    ELSE 'third_party_balances'
  END,
  CASE
    WHEN code ~ '^49' THEN 'credit'
    WHEN code IN ('409','411','413','416','417','418','422','425','4287','441','442','443','445','4487','451','456','458','462','465','467','4687','486') THEN 'debit'
    WHEN code IN ('401','403','404','405','408','419','421','426','427','431','432','438','444','447','457','481','487','4286','4486','4686') THEN 'credit'
    ELSE 'both'
  END,
  true,
  code ~ '^49'
FROM public.pcg2005_accounts
WHERE code ~ '^(40|41|42|43|44|45|46|47|48|49)'
ON CONFLICT (account_code) DO NOTHING;

-- Class 5: financial assets and cash. Internal transfers are never presented as cash.
INSERT INTO public.pcg2005_balance_sheet_rules(account_code,section,line_key,normal_side,contra_asset)
SELECT code,
  CASE WHEN code IN ('516','519') THEN 'current_liabilities'
       WHEN code ~ '^58' THEN 'clearing'
       ELSE 'current_assets' END,
  CASE WHEN code='509' THEN 'unpaid_short_term_investments'
       WHEN code='516' THEN 'current_portion_of_long_term_debt'
       WHEN code ~ '^50' THEN 'short_term_investments'
       WHEN code ~ '^51' THEN 'bank_and_financial_institutions'
       WHEN code='52' THEN 'treasury_instruments'
       WHEN code='53' THEN 'cash_on_hand'
       WHEN code='54' THEN 'cash_advances'
       WHEN code ~ '^58' THEN 'internal_transfers_pending'
       WHEN code ~ '^59' THEN 'cash_impairment'
       ELSE 'unclassified_financial_asset' END,
  CASE WHEN code IN ('509','516','519') OR code ~ '^(58|59)' THEN 'credit'
       ELSE 'debit' END,
  code IN ('509') OR code ~ '^59'
FROM public.pcg2005_accounts
WHERE code ~ '^(50|51|52|53|54|58|59)'
ON CONFLICT (account_code) DO NOTHING;


-- Separate passif rules: a mixed PCG account may be an asset on its debit
-- balance and a liability on its credit balance; one asset rule cannot express both.
CREATE TABLE IF NOT EXISTS public.pcg2005_balance_sheet_passif_rules (
  account_code text PRIMARY KEY REFERENCES public.pcg2005_accounts(code) ON DELETE RESTRICT,
  section text NOT NULL CHECK (section IN ('equity','non_current_liabilities','current_liabilities','review')),
  line_key text NOT NULL,
  normal_side text NOT NULL CHECK (normal_side IN ('debit','credit','both')),
  requires_maturity boolean NOT NULL DEFAULT false,
  contra_equity boolean NOT NULL DEFAULT false,
  source_reference text NOT NULL DEFAULT 'PCG 2005, Annexe II, bilan capitaux propres et passif'
);
ALTER TABLE public.pcg2005_balance_sheet_passif_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pcg2005_balance_sheet_passif_rules_read ON public.pcg2005_balance_sheet_passif_rules;
CREATE POLICY pcg2005_balance_sheet_passif_rules_read
  ON public.pcg2005_balance_sheet_passif_rules FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pcg2005_balance_sheet_passif_rules FROM PUBLIC, anon;
GRANT SELECT ON public.pcg2005_balance_sheet_passif_rules TO authenticated;

INSERT INTO public.pcg2005_balance_sheet_passif_rules
  (account_code,section,line_key,normal_side,requires_maturity,contra_equity)
SELECT code,
  CASE
    WHEN code IN ('101','104','105','106','107','108','109','110','119','120','129') THEN 'equity'
    WHEN code IN ('131','132','134','138','229') OR code ~ '^15' OR code ~ '^(16|17)' THEN 'non_current_liabilities'
    WHEN code IN ('401','403','404','405','408','419','421','422','426','427','4286','431','432','438','444','445','447','4486','451','455','456','457','458','464','467','4686','481','487','516','519') THEN 'current_liabilities'
    ELSE 'review'
  END,
  CASE
    WHEN code IN ('101','108','109') THEN 'equity_capital'
    WHEN code IN ('104','106') THEN 'equity_premiums_and_reserves'
    WHEN code='105' THEN 'equity_revaluation'
    WHEN code='107' THEN 'equity_equivalence'
    WHEN code IN ('110','119') THEN 'equity_retained_earnings'
    WHEN code IN ('120','129') THEN 'equity_current_result'
    WHEN code IN ('131','132') THEN 'investment_grants'
    WHEN code IN ('134','138') THEN 'deferred_tax_liability'
    WHEN code ~ '^15' THEN 'non_current_provisions'
    WHEN code ~ '^16' THEN 'non_current_borrowings'
    WHEN code ~ '^17' THEN 'participation_debts'
    WHEN code IN ('401','403','408','419') THEN 'suppliers_and_attached'
    WHEN code IN ('421','422','426','427','4286') THEN 'employee_payables'
    WHEN code IN ('431','432','438') THEN 'social_payables'
    WHEN code IN ('444','445','447','4486') THEN 'tax_payables'
    WHEN code IN ('404','405') THEN 'other_debts'
    WHEN code IN ('481','487') THEN 'provisions_and_deferred_income'
    WHEN code='516' THEN 'current_portion_of_long_term_debt'
    WHEN code='519' THEN 'bank_overdrafts'
    WHEN code IN ('451','455','456','457','458','464','467','4686') THEN 'other_current_payables'
    ELSE 'unclassified_passif'
  END,
  CASE WHEN code IN ('109','119','129','169') THEN 'debit'
       WHEN code='108' THEN 'both'
       ELSE 'credit' END,
  (code ~ '^(16|17)' OR code='401'),
  code IN ('109','119','129')
FROM public.pcg2005_accounts
WHERE kind IN ('liability','equity','clearing')
ON CONFLICT (account_code) DO NOTHING;

CREATE OR REPLACE VIEW public.pcg2005_balance_sheet_passif_mapping_gaps
WITH (security_invoker=true) AS
SELECT a.code,a.label,a.kind
FROM public.pcg2005_accounts a
LEFT JOIN public.pcg2005_balance_sheet_passif_rules r ON r.account_code=a.code
WHERE a.kind IN ('liability','equity','clearing') AND r.account_code IS NULL;
REVOKE ALL ON public.pcg2005_balance_sheet_passif_mapping_gaps FROM anon;
GRANT SELECT ON public.pcg2005_balance_sheet_passif_mapping_gaps TO authenticated;

DO $passif_assert$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pcg2005_balance_sheet_passif_mapping_gaps) THEN
    RAISE EXCEPTION 'PCG 2005 passif catalog contains accounts without explicit presentation rules';
  END IF;
END $passif_assert$;

CREATE OR REPLACE VIEW public.pcg2005_balance_sheet_mapping_gaps
WITH (security_invoker=true) AS
SELECT a.code,a.label,a.kind
FROM public.pcg2005_accounts a
LEFT JOIN public.pcg2005_balance_sheet_rules r ON r.account_code=a.code
WHERE a.code ~ '^(1|2|3|4|5)' AND r.account_code IS NULL;

REVOKE ALL ON public.pcg2005_balance_sheet_mapping_gaps FROM anon;
GRANT SELECT ON public.pcg2005_balance_sheet_mapping_gaps TO authenticated;

DO $catalog_assert$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pcg2005_balance_sheet_mapping_gaps) THEN
    RAISE EXCEPTION 'PCG 2005 balance-sheet catalog contains accounts without explicit presentation rules';
  END IF;
END $catalog_assert$;

COMMENT ON TABLE public.pcg2005_balance_sheet_rules IS
  'Explicit PCG 2005 balance-sheet presentation rules. Receivable/payable accounts require documented maturity; suspense and mixed balances are not silently classified.';
