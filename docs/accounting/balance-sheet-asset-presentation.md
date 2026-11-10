# MAGNISA — Présentation PCG 2005 de l'actif du bilan

## Périmètre

Le moteur présente l'actif à partir des lignes du grand livre dont l'écriture est validée et dont la date est antérieure ou égale à la clôture de l'exercice. Les écritures brouillon, annulées ou non validées ne sont pas retenues.

La nomenclature et les règles de présentation sont stockées dans `pcg2005_accounts` et `pcg2005_balance_sheet_rules`. La migration de catalogue complète les comptes utiles des classes 1 à 5 sans remplacer les identifiants des comptes déjà utilisés.

## Règles de calcul

- Actif brut : solde débiteur des comptes d'actif, calculé comme débit moins crédit.
- Amortissements et dépréciations correctrices : comptes créditeurs présentés en diminution de l'actif, sans les reclasser en passif.
- Valeur nette : valeur brute moins amortissements cumulés et dépréciations.
- Les comptes PCG à solde débiteur ou créditeur possible (422, 442, 443, 445, 451, 456, 458 et 467) sont ventilés selon leur solde réel entre actif et passif, sans compensation artificielle. Les comptes transitoires restent bloqués jusqu’à justification.
- Le compte 36, indiqué comme disponible dans le PCG 2005, n’est pas retenu comme compte de stock dans le bilan.
- Chaque ligne de présentation conserve les codes et libellés des comptes ou pièces auxiliaires qui la composent.

## Immobilisations

Le registre des immobilisations reste la source auxiliaire. La vue `fixed_asset_register_reconciliation` compare les valeurs du registre et les soldes du grand livre. Tout écart non nul est porté dans les anomalies de l'actif. Les écritures historiques ne sont pas réécrites.

## Stocks et en-cours

MAGNISA utilise un inventaire intermittent de clôture. Un inventaire doit être rattaché à l'exercice et daté exactement de sa date de clôture. Les lignes enregistrent la référence, la désignation, l'unité, le compte de stock, la quantité physique, le coût unitaire retenu et, le cas échéant, le compte 39 et la dépréciation.

Les valeurs brute et nette sont calculées par PostgreSQL. Les comptes de dépréciation 391 à 398 sont contraints à la famille de stock correspondante. Un inventaire approuvé est immuable; une correction passe par une contrepassation motivée puis un nouveau comptage. L'inventaire physique et les comptes 31 à 38 / 39 sont rapprochés avant validation.

Le coût unitaire doit être documenté selon la méthode choisie (CUMP, FIFO ou identification spécifique). Le registre de clôture ne prétend pas reconstruire un coût historique lorsque les factures d'achat ne contiennent pas de lignes article/quantité.

## Créances clients et échéances

La fonction `get_accounting_receivable_maturity` est une RPC SECURITY DEFINER réservée aux utilisateurs authentifiés ayant `accounting.view`. Elle contourne les permissions RLS propres à la facturation et à la trésorerie uniquement après vérification de la permission comptable et de l'organisation.

Les factures sont prises en compte selon leur date d'émission et leur date d'annulation à la clôture locale de Madagascar. Les règlements confirmés ou rapprochés sont retenus selon leur date de paiement. Les échéances à moins de douze mois sont courantes; au-delà, elles sont non courantes. Les créances sans échéance, les règlements non datés, les règlements non affectés, les écarts facture/règlement et l'écart avec le compte 411 bloquent la validation.

## Trésorerie

Chaque compte financier possède un code PCG de classe 5 explicite. Les valeurs par défaut sont 512 pour banque, 517 pour mobile money et 53 pour caisse; la colonne reste modifiable dans le modèle de données pour les cas particuliers.

La RPC `get_accounting_cash_reconciliation`, réservée à `accounting.view`, compare :
1. le solde courant du compte financier avec ses mouvements;
2. le solde auxiliaire à la date de clôture avec le grand livre par compte PCG.

Les comptes sans mapping et les écarts empêchent la validation de l'actif.

## Sécurité et traçabilité

- Les RPC SECURITY DEFINER vérifient `auth.uid()`, la permission comptable et l'organisation.
- Les tables d'inventaire appliquent RLS.
- Les inventaires approuvés ne sont pas modifiables; les contrepassations sont justifiées et historisées.
- Aucune donnée fictive n'est créée pour équilibrer ou compléter un bilan.
- Les migrations sont additives; aucune écriture validée n'est modifiée.

## État de recette connu au début du chantier

L'audit de production a relevé zéro exercice comptable, zéro immobilisation, zéro inventaire physique, zéro créance client ouverte, quatre lignes non mappées et un écart de 9 932 000 MGA entre le registre des immobilisations et le compte 218. Les soldes de banque, mobile money et caisse concordaient avec leurs mouvements et les comptes 512, 517 et 53.

Ces observations sont des données de départ, pas une validation de clôture. Le bilan ne peut être déclaré opérationnel en production qu'après application contrôlée des migrations, création/confirmation de l'exercice réel, inventaire physique approuvé, résolution des lignes non mappées, rapprochements sans écart et recette sur une session authentifiée.

## Références normatives

Les règles de classement et de présentation sont alignées sur le Plan comptable général 2005 de Madagascar, notamment les classes 1 à 5, les comptes correcteurs d'actif et les dispositions relatives aux créances et stocks. Toute décision de valorisation doit rester justifiée par les pièces et les méthodes autorisées.

## Source-specific supplier invoice classification

The generic `EXPENSE:SUPPLIER` key must never inherit a balance-sheet account such as 218 for every supplier invoice. The source-specific mapping layer records the supplier invoice independently of the generic key.

Computer Store invoice 2030 (`DFO-00003`, MGA 30,000; source note: Achat de souris) and invoice 2031 (`DFO-00004`, MGA 50,000; source note: Achat d'encre) are classified to PCG 2005 account 606, Achats non stockés de matières et fournitures. These are low-value, non-stocked supply purchases, not fixed assets. The posted journal entries are not rewritten.

Both source records have no attached invoice (`attachment_url IS NULL`). The overrides therefore retain `evidence_status=record_only` and `requires_attachment=true`; the original invoices remain required audit support. Other generic supplier purchases remain unmapped until their nature is evidenced. The PCG 2005 Guide annoté, XI.23, identifies account 606 for non-stocked purchases and account 605 for purchases of materials, equipment and works.
