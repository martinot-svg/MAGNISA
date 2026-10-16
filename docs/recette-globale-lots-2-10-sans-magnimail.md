# MAGNISA — Audit et intervention transverse lots 2 à 10, hors MAGNIMAIL
Date : 2026-10-16
Branche : `lot1-securite-financiere`
Base autorisée : `MAGNISA-TEST` — `jrotsmzkyjsibmbnqxtz`
Production Supabase `pmlzirobpdlzsrvtkvir` : non modifiée.
GitHub `main` : non modifié.
Vercel Production : non déployé.
Périmètre : tous les modules, **sauf MAGNIMAIL et les emails**.

## Source comptable
Plan Comptable Général 2005 de Madagascar, décret n°2004-272 du 18 février 2004, document fourni par le client (165 pages PDF).
Repères : 121-3 et 123-8 (comptabilité d'exercice et non-compensation), 210-1 (états financiers), 338-2/338-3 (prestations de services), 410 et 420 (organisation et partie double), 430 (livres, fiabilité et audit), annexe I pages imprimées 144–154 (nomenclature).
Le document de 2005 n'atteste pas à lui seul de toutes les obligations légales ou fiscales en vigueur en 2026 : revue juridique et expert-comptable requise.

## Résultats effectivement appliqués

### Sécurité transversale (lot 1, prolongé)
- Permissions critiques de paiement supprimées pour les RPC historiques `record_invoice_payment`, `record_expense`, `transfer_funds`, `record_supplier_payment`, `record_payroll_payment`. Les fonctions enveloppes `SECURITY DEFINER` conservent la vérification d'organisation et de rôle.
- Paiements fournisseurs et salaires : wrappers `lot2_record_supplier_payment_idempotent` et `lot2_record_payroll_payment_idempotent` avec clé UUID, empreinte de paramètres, verrouillage `FOR UPDATE`, rejet de réutilisation incohérente, mémorisation du résultat.
- Formulaires fournisseurs/paie : envoi de clé stable par soumission ; correction de placement de la clé dans le formulaire de paie.
- Révocation `TRUNCATE`, `TRIGGER`, `REFERENCES` du rôle applicatif pour les tables métiers et financières ciblées.

### Lot 2 — Gestion commerciale
- Schéma et parcours existants inspectés : clients, services, devis, factures, lignes, transformations, facturation et paiements.
- **À terminer** : tests interactifs exhaustifs, édition des devis et factures, PDF, avoirs, annulations, états, remises et calculs fiscaux selon entreprise.

### Lot 3 — Trésorerie
- Rappel des comptes distincts caisse, banque, Mobile Money, chèques.
- Transferts et encaissements protégés par clés idempotentes ; paiements fournisseurs et paie étendus.
- **À terminer** : rapprochements de banque réels, chèques, imports de relevés, soldes d'ouverture justifiés, tests de concurrence complets.

### Lot 4 — Comptabilité PCG 2005
- Migration `20261016140000_pcg2005_accounting_foundation.sql` ajoutée et appliquée sur TEST : catalogue des comptes PCG, imputation manuelle RLS par entreprise, vues `pcg2005_journal_lines`, `pcg2005_trial_balance`, `pcg2005_journal_integrity` toutes à droits de l'invocateur.
- Migration `20261016153000_pcg2005_catalog_corrections.sql` appliquée : rectification du compte 203 et compléments de nomenclature.
- Écran Comptabilité enrichi avec balance, total débit/crédit, alerte d'anomalies et formulaire de correspondance réservé aux rôles comptables.
- Les comptes de charge inconnus ne sont **pas** affectés arbitrairement à 658 : ils restent NON_CLASSE tant que le responsable financier n'a pas validé l'imputation.
- **TEST** : 55 comptes de référence, 5 écritures existantes vérifiées ; zéro anomalie d'équilibre et zéro rubrique non classée dans la situation actuelle. Un membre voit les écritures autorisées ; un identifiant sans appartenance ne voit aucune écriture.
- **À terminer** : catalogue PCG exhaustif, balances d'ouverture, écritures d'inventaire, clôture et verrouillage de périodes, grand livre et livre journal exportables, bilan et compte de résultat réglementaires, tableau de flux et tableau des capitaux propres, annexe, validations comptables et fiscales.
- Les états de gestion antérieurs ne peuvent **pas** être présentés comme états réglementaires certifiés.

### Lot 5 — Dettes et associés
- Correction du calcul des positions associés : compensation des mouvements **par associé** et séparation des positions débitrices/créditrices **entre associés** (principe PCG 123-8).
- **À terminer** : réconciliation des écritures associés, suivi des remboursements, échéanciers, provisions et justification des créances.

### Lot 6 — Paie
- Paiements salariaux désormais protégés contre les doublons et contournements directs de RPC.
- **À terminer** : tests de bulletins, déductions, recouvrement des avances, taux réglementaires, obligations sociales, corrections et bulletins PDF.

### Lot 7 — Tableaux de bord et rapports
- Parcours de calcul inspecté ; mesures existantes alimentées par les opérations enregistrées.
- **À terminer** : rapprochement analytique/PCG, filtres de périodes, graphiques, budget/prévisions, validation des exports de rapports.

### Lot 9 — Administration SaaS
- RLS pour imputation PCG par entreprise ; seuls les détenteurs de la permission `accounting.manage` peuvent classifier une écriture.
- **À terminer** : recette des paramètres par organisation, gestion complète des autorisations et modèle documentaire, sauvegardes, restauration.

### Lot 10 — Recette, fiabilité et performance
- Builds Vercel Preview des modifications comptables et financières : `READY`.
- Tests SQL : restrictions d'accès entre entreprises, privilèges RPC et vues comptables.
- **À terminer** : tests réels navigateur et mobile, test Auth signed JWT end-to-end, sessions et cookies, tests de régression sur formulaires fournisseurs/paie/PCG, tests d'accessibilité et performances.
- Important : un build Vercel `READY` démontre la compilation, pas la correction fonctionnelle complète.

## Critères de libération
Aucun merge `main`, aucun déploiement Production, aucune migration Production avant :
1. Toutes les procédures qui modifient des balances ou des états financiers auditée et testées sur TEST.
2. Réconciliation créances, dettes, soldes financiers et journaux à zéro écart injustifié.
3. Permissions et RLS contrôlées avec identités Auth réelles et multi-tenant.
4. Tous les parcours d'interface critiques réussis en desktop et mobile.
5. Comparaison PCG des écritures et états réglementaires relue par un professionnel habilité.
6. Test sauvegarde / restauration et plan de rollback.

**État : améliorations concrètes appliquées et compilées, recettes globales encore partielles. Ne pas déclarer conformité 100 %.**
