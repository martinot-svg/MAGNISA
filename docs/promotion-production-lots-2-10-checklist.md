# MAGNISA — Décision de promotion en production (bloquée jusqu'à recette)
Date : 2026-10-16
Périmètre : lots 1-7, 9 et 10 ; **MAGNIMAIL exclu**.
Source normative : Plan Comptable Général 2005 (Madagascar), décret n°2004-272. Revue légale 2026 non présumée.

## État constaté (lecture seule)
- Branche lot1-securite-financiere : 18 commits en avance sur main au début de cette revue.
- Supabase TEST : 50 tables, migrations de renforcement et fondation PCG appliquées.
- Supabase Production : 47 tables, 4 organisations, 7 factures, 15 écritures comptables, 5 paiements à préserver.
- TEST : 55 comptes PCG, 5 écritures, 0 anomalie d'équilibre dans la vue d'intégrité ; ceci ne certifie ni la conformité PCG ni la qualité des imputations.
- Sur TEST : les anciennes RPC record_invoice_payment, record_expense, transfer_funds, record_supplier_payment et record_payroll_payment ne sont plus exécutables par authenticated. Les enveloppes supplier/payroll sont exécutables.
- L'existence d'un déploiement Preview READY ne vaut pas recette utilisateur complète.

## Critères obligatoires avant déploiement
- [ ] Audit de toutes les procédures métier qui écrivent un solde, une facture, une créance, une dette ou une écriture. Exécutions concurrentes vérifiées.
- [ ] RLS, droits et contexte authentifié réels pour plusieurs entreprises (y compris utilisateurs sans habilitation).
- [ ] Recette navigateur : client → service → devis → acceptation → facture → paiements et avoirs.
- [ ] Trésorerie : banque, caisse, mobile money, chèques, rapprochement, transferts, frais, soldes d'ouverture.
- [ ] Comptabilité : plan de comptes complet par entreprise ; corrections justifiées ; immobilisations, inventaire, fermeture des périodes, livres et pièces numérotées ; partie double vérifiée.
- [ ] États PCG 2005 : bilan, résultat, variations des capitaux propres, flux, annexe, comparatifs N/N-1 ; consultation et validation professionnelle.
- [ ] Fournisseurs, dettes, associés, emprunts, paie, obligations, budgets, tableaux de bord : écritures, flux, permissions et exports testés.
- [ ] Factures/devis PDF : intégrité des montants, conformité des numéros, rendu aperçu/impression, templates entreprise.
- [ ] Tests ordinateur/tablette/mobile, erreurs réseau, accessibilité et performance.
- [ ] Aucun secret publié dans repository/preview ; variables Production préservées.
- [ ] Stratégie d'upgrade : inventaire des migrations existantes de Production, transactions et migrations ordonnées sans rejouer les migrations historiques de TEST.
- [ ] Sauvegarde Production avec **restauration essayée** dans un projet distinct ; validation des comptes 4/7/15/5 et de la cohérence des écritures.
- [ ] Plan de rollback applicatif ; pour les changements SQL non réversibles, plan de restauration documenté.
- [ ] Rapport de recette signé et feu vert explicite après examen des résultats.

## Garde-fous de publication
1. Ne jamais remplacer Supabase Production par MAGNISA-TEST : la base de test n'est pas la base des clients.
2. Ne jamais écraser les utilisateurs Auth, identifiants, profils ou données comptables de production par ceux du test.
3. Ne pas utiliser le SQL de restauration historique MAGNISA-TEST comme migration appliquée à une production déjà existante.
4. Migrer **les différences de schéma approuvées**, pas les données fictives du test ; identifier les risques de GRANT, FK, index et droits sur les RPC.
5. Préparer PR branche dev → main seulement après tous les contrôles ; ne pas fusionner automatiquement.
6. Ne déployer et ne pointer le domaine de production qu'après succès post-migration des smoke tests.
7. MAGNIMAIL n'est pas modifié dans ce lot ; tester l'absence de régression de ses configurations existantes sans étendre son périmètre.

## Traçabilité PCG 2005
- Art. 121-3 : comptabilité d'exercice.
- Art. 123-8 : non-compensation.
- Art. 210-1 : composition des états financiers.
- Art. 338-2 et 338-3 : produits des services selon avancement.
- Art. 420-1 à 420-4 : partie double, justification, clôture et intangibilité.
- Art. 430-1 et 430-2 : livres, sauvegarde, piste de révision et logiciel.
- Annexe 1 : modèles de bilan, résultat, flux et variations des capitaux propres.

**Décision au 2026-10-16 : NO-GO production.** L'autorisation de l'utilisateur d'envisager la promotion ne remplace pas la validation technique et comptable.
