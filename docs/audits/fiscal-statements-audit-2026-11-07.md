# Audit du module des états financiers MAGNISA
Date de vérification : 7 novembre 2026
Projet Supabase vérifié : `pmlzirobpdlzsrvtkvir` (PostgreSQL 17)
Dépôt : `martinot-svg/MAGNISA`

## Verdict de l'audit initial

**BILAN ET ÉTATS FINANCIERS NON TERMINÉS**

L'existant est une fondation utile : exercices comptables, à-nouveaux, clôture contrôlée, agrégation PCG, cinq rubriques de sortie et exports PDF/Excel sont présents. En revanche, le moteur de présentation n'est pas complet et bloque volontairement la validation finale. Les données de production ne permettent pas encore une recette annuelle réelle : aucune période/exercice comptable n'est enregistrée.

Aucune migration de production ni écriture comptable n'a été modifiée pendant cet audit.

## 1. État réel de la base de production

Constats obtenus par requêtes SQL en lecture seule :

- Le projet Supabase est actif, PostgreSQL 17.
- `accounting_fiscal_years` et les RPC `magnisa_create_fiscal_year`, `magnisa_close_fiscal_year` et `magnisa_update_fiscal_year_notes` existent.
- Aucun exercice n'est enregistré dans `accounting_fiscal_years`; aucune période n'est enregistrée dans `accounting_periods`.
- Le grand livre contient 72 écritures, toutes au statut `posted`, et 150 lignes.
- Total débit et crédit des en-têtes : 65 055 599,92 MGA chacun.
- Total débit et crédit des lignes : 65 055 599,92 MGA chacun.
- Le contrôle d'intégrité constate 72 écritures équilibrées.
- Le mapping des lignes PCG : 130 automatiques, 16 manuelles et 4 `a_mapper`.
- Aucun exercice N ou N-1 n'existe : aucun rapprochement annuel ni comparatif réel ne peut être validé à ce stade.
- La table `fixed_assets` existe mais ne contient aucune fiche. Aucun registre/table dédié aux stocks, aux provisions, aux dépréciations, aux charges constatées d'avance, aux produits constatés d'avance ou aux dotations d'amortissement n'a été identifié sous les noms usuels interrogés.

Conséquence : l'égalité débit/crédit du grand livre est vérifiée pour les écritures présentes, mais cela ne démontre ni l'exhaustivité des imputations, ni la justesse d'un bilan de clôture.

## 2. État du code existant

### Fonctionnalités déjà présentes

- Page des états financiers et sélection d'exercice.
- Agrégation des lignes PCG validées.
- Comparaison des soldes par compte avec le dernier exercice antérieur trouvé.
- Calcul du résultat à partir des comptes de produits et charges.
- Tableau de variation des capitaux propres simplifié.
- Tableau de flux de trésorerie heuristique.
- Notes annexes sous forme de neuf rubriques textuelles.
- Exports PDF et Excel.
- RPC de création d'exercice, de report des soldes et de clôture.
- Tests SQL d'ouverture, d'équilibre des à-nouveaux, de non-chevauchement, de clôture et de report.

### Lacunes bloquantes identifiées

1. **Nomenclature et présentation du bilan** : le catalogue `pcg2005_accounts` en production contient 60 lignes réparties entre six catégories de calcul. Il ne constitue pas à lui seul une nomenclature exhaustive ni une table de présentation des postes. Le code regroupe par `kind` (actif, passif, capitaux propres) sans ventilation courant/non courant, sans rubriques minimales complètes et sans justification des échéances.
2. **Compte de résultat** : l'affichage actuel juxtapose produits et charges. Les rubriques minimales du PCG (résultat opérationnel, produits/charges financiers, impôt sur le résultat, résultat des activités ordinaires et éléments extraordinaires) ne sont pas construites comme telles.
3. **Flux de trésorerie** : la classification dépend d'une heuristique fondée sur une seule contrepartie. Les écritures complexes sont exclues et comptées comme non classées. Le rapprochement du flux opérationnel avec le résultat avant impôt exigé pour la méthode directe n'est pas développé. Les intérêts/dividendes ne sont pas isolés.
4. **Variation des capitaux propres** : le tableau est calculé par compte avec ouverture, hausse, baisse et clôture ; il ne distingue pas les natures de mouvements minimales (résultat, corrections, autres éléments comptabilisés directement en capitaux propres, apports, distributions et affectations).
5. **Annexe** : neuf champs libres ne constituent pas encore une annexe structurée. Les tableaux de mouvements d'immobilisations, amortissements, stocks, dépréciations, échéances des créances/dettes, provisions, engagements et renvois vers les postes des états ne sont pas alimentés automatiquement.
6. **Contrôles de clôture** : le code de préparation ne détecte pas encore les opérations d'inventaire manquantes, les échéances courantes/non courantes manquantes, ni l'exhaustivité des écritures non validées. Le contrôle de l'équilibre des écritures est présent, mais insuffisant pour conclure sur l'image fidèle. La RPC de clôture contrôle les écritures déséquilibrées et les lignes postées non imputées, mais ne rejette pas explicitement les écritures brouillon équilibrées dans la période. La RPC de mise à jour des notes ne bloque pas non plus la modification des notes d'un exercice déjà clôturé ; il manque un statut de validation et une capture immuable pour protéger un état approuvé.
7. **Statuts** : le modèle d'exercice distingue seulement `open` et `closed`. Il n'existe pas de cycle de validation des états financiers avec états `PROJET`, `EN ATTENTE DE VALIDATION`, `VALIDÉ`, identité du valideur, horodatage et instantané immuable des états approuvés.
8. **Exports** : les routes PDF/Excel incluent les cinq états, mais ne restituent pas encore toutes les données d'identification prévues par le PCG (adresse, forme juridique, pays, activité, etc.), la date d'édition et un statut de validation distinct. L'export Excel actuel est un classeur XML Spreadsheet 2003 avec extension `.xls`, et non un fichier `.xlsx` natif.
9. **Tests** : le test TypeScript dédié aux états financiers vérifie surtout la fonction de décision `isFiscalStatementReady`; il ne couvre pas les calculs complets sur jeux de données comptables représentatifs. Le test SQL de cycle de vie des exercices ne remplace pas des tests de bilan, résultat, flux, variation des capitaux propres et annexe.

Le code force actuellement `operatingCashFlowReconciliationReady=false` et `pcgPresentationReady=false`. Ce verrou est prudent et doit rester en place tant que les calculs et contrôles correspondants ne sont pas effectivement développés.

## 3. PR #99 et PR #104

- La description de la PR #99 annonce les exercices, à-nouveaux, clôture contrôlée, annexe, exports et contrôles de préparation. Elle précise explicitement que la migration n'était pas appliquée en production et que les états restaient `PROJET / NON VALIDÉ` tant que les rapprochements opérationnels et la présentation PCG complète n'étaient pas implémentés.
- La description de la PR #104 apporte notamment des contrôles de clôture et un runbook de bascule. Elle signale des écarts entre le schéma de production et le candidat de livraison, et demande une réconciliation de l'historique des migrations avant migration.
- Dans la base consultée maintenant, la table d'exercices et ses RPC existent déjà. L'historique Supabase enregistre `accounting_fiscal_year_opening_closing` sous la version `20261107062940`, alors que le fichier Git identifié porte le préfixe `20261105100000`. Cette divergence d'identifiant impose une réconciliation avant tout nouvel enregistrement ou rejeu de migration. Ne pas appliquer aveuglément le fichier par son nom.

Cet audit porte sur les descriptions accessibles des PR et les fichiers présents sur la branche principale. Il ne constitue pas une revue exhaustive ligne par ligne de tous les commentaires et commits de ces PR.

## 4. Référentiel applicable

Le PCG 2005 est homologué par le décret n°2004-272 du 18 février 2004. Le document officiel prévoit cinq composantes pour les entités autres que les micro et petites entités assujetties au Système Minimal de Trésorerie : bilan, compte de résultat, tableau des variations des capitaux propres, tableau des flux de trésorerie et annexe.

Le champ d'application et le régime doivent toutefois être déterminés pour chaque entreprise. Le PCG prévoit un cas particulier MPE/SMT et renvoie à des référentiels ou guides sectoriels pour certaines activités. Le Conseil Supérieur de la Comptabilité indiquait en octobre 2026 une dynamique de réforme/convergence des référentiels nationaux. Avant de figer le référentiel d'une entité, il faut donc vérifier son statut, sa taille, son activité, son secteur et les textes en vigueur à la date de clôture.

Sources officielles :
- PCG 2005, décret n°2004-272 : https://www.mef.gov.mg/csc/ckfinder/userfiles/files/plan-comptable-general-2005.pdf
- Guide annoté du PCG 2005, arrêté n°3169 du 14 avril 2005 : https://www.mef.gov.mg/csc/ckfinder/userfiles/files/guide-annote-pcg-2005.pdf
- Conseil Supérieur de la Comptabilité, informations sur l'évolution du référentiel : https://www.mef.gov.mg/csc/page_personnalisee/index/menu/18

Articles particulièrement pertinents du PCG 2005 :
- 114-1 et 114-2 : champ d'application, sous réserve de dispositions spécifiques.
- 141-1 à 141-5 : cas des micro et petites entités assujetties au SMT.
- 210-1 : contenu des cinq composantes pour les entités autres que celles au SMT.
- 210-4 à 210-6 : identification, monnaie de présentation et comparatifs.
- 220-2 et 220-4 : rubriques minimales du bilan et distinction courant/non courant.
- 230-1 et 230-2 : rubriques minimales du compte de résultat.
- 240-1 et 240-2 : mouvements des capitaux propres.
- 250-2 à 250-5 : classification et méthodes du tableau des flux.
- 260-1 et 260-2 : annexe structurée et renvois entre états.

## 5. Décisions de sécurité prises pendant l'audit

- Aucune écriture réelle n'a été créée, modifiée ou supprimée.
- Aucun exercice n'a été créé avec des soldes initiaux non justifiés.
- Aucune migration n'a été appliquée à la production.
- Aucun changement RLS ou RPC n'a été effectué.
- Aucun état n'a été marqué validé.
- Les données de production ont été interrogées en lecture seule.

## 6. Conditions avant une livraison complète

1. Fixer le profil comptable/réglementaire par entreprise (PCG complet ou régime SMT, et guide sectoriel si nécessaire).
2. Compléter le référentiel de comptes et la table de correspondance vers les rubriques des états.
3. Construire les ventilations courant/non courant sur échéances documentées.
4. Relier les immobilisations, stocks, dépréciations, provisions et écritures de régularisation à des pièces et validations.
5. Construire les cinq états selon les modèles PCG, avec comparatifs N/N-1.
6. Construire le tableau des flux selon une méthode définie et documenter les rapprochements.
7. Ajouter un workflow de validation et un instantané historique immuable.
8. Compléter les exports et leurs mentions obligatoires.
9. Ajouter des jeux de tests déterministes, déficitaires, avec immobilisations, stocks, créances/dettes, inventaire et exercices successifs.
10. Réconcilier les identifiants de migration, exécuter les préflights, sauvegarder et vérifier la restauration avant toute migration de production.
11. Faire la recette avec des données anonymisées et vérifier l'isolation multi-entreprise.

**Conclusion :** le socle technique est présent et les écritures actuellement enregistrées sont équilibrées au niveau global. Le module n'est pas encore un générateur d'états financiers PCG 2005 complet et validable. Les quatre lignes non imputées, l'absence d'exercice en production et les fonctions de présentation explicitement inachevées interdisent toute validation comptable réelle.
