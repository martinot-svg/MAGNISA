# Correctif IRSA Madagascar 2026 - préparation isolée

## Périmètre

Cette branche prépare le barème IRSA de droit commun applicable en 2026. Elle ne modifie aucune donnée Supabase et ne change aucun bulletin déjà enregistré. Le nouveau jeu de paramètres est créé, à la demande d'un administrateur dans l'application, au statut `pending_review` avec une date de préparation au 7 novembre 2026. Il n'est jamais activé automatiquement.

## Référence fiscale

La loi n°2025-021 portant loi de finances pour 2026, article 01.03.16, fixe les taux marginaux suivants : 0 % jusqu'à 350 000 Ar, 5 % jusqu'à 400 000 Ar, 10 % jusqu'à 500 000 Ar, 15 % jusqu'à 600 000 Ar, 20 % jusqu'à 4 000 000 Ar, puis 25 % au-delà. Le texte officiel est disponible à https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf.

Le référentiel proposé reprend également le minimum de perception de 3 000 Ar et la réduction de 2 000 Ar par personne à charge au-delà de 350 000 Ar, conformément aux articles 01.03.16 et 01.03.19 du Code général des impôts publié par la DGI le 6 février 2025. La base est arrondie à la centaine d'Ariary inférieure. Source DGI : https://portal.impots.mg/textes/textes/2025-02-06--N-2025-MEF.SG.DGI-Ref-HIH9EC-3OPLT3.pdf.

La loi de finances rectificative n°2026-004 a été adoptée le 22 juin 2026 et déclarée conforme par la HCC le 15 juillet 2026. La décision HCC consultée ne cite ni l'IRSA ni l'article 01.03.16, mais elle ne reproduit pas le texte fiscal intégral. La référence IRSA doit donc être relue dans le corps de la LFR promulguée avant toute activation.

## Date d'effet préparée

Le 7 novembre 2026 est utilisé comme date de préparation opérationnelle afin de ne pas recalculer rétroactivement les périodes antérieures ni modifier les bulletins déjà établis. Cette date n'affirme pas que la loi fiscale est entrée en vigueur à cette date : le barème légal 2026 est celui de la loi de finances initiale. Les périodes antérieures restent dans leur historique.

## Contrôles ajoutés

- Barème progressif à six tranches, avec plafond final ouvert.
- Arrondi de la base à la centaine inférieure.
- Minimum de perception de 3 000 Ar, sauf base imposable nulle.
- Réduction de 2 000 Ar par personne à charge, sans descendre sous le minimum.
- Validation stricte des bornes, taux, personnes à charge et montants.
- Tests unitaires sur les seuils, les frontières, la tranche supérieure à 4 millions, l'arrondi, les réductions et les entrées invalides.

## Conditions avant activation

1. Vérifier le texte intégral promulgué de la LFR 2026 pour confirmer qu'aucune disposition n'a modifié les articles 01.03.16 et 01.03.19.
2. Vérifier chaque autre paramètre social copié depuis le référentiel de l'organisation : aucun taux CNaPS, SMIE, FMFP ou plafond n'est certifié par ce correctif.
3. Faire relire le référentiel par un responsable paie/fiscalité.
4. Activer explicitement la version dans MAGNISA seulement après validation documentaire.


## Mise à jour sociale vérifiée au 6 novembre 2026

- Décret n°2026-1358 : à compter du 1er octobre 2026, le SME M1-1A non agricole est de 315 000 Ar. Le plafond de cotisation CNaPS/SMIE/FMFP à 8 × SME est donc de 2 520 000 Ar. La version préparée pour le régime général remplace les anciens plafonds de 2 400 000 Ar et 1 600 000 Ar par 2 520 000 Ar.
- CNaPS : 1 % salarié et 13 % employeur.
- SMIE : l'article 25 du décret n°2003-1162 fixe un minimum de 1 % salarié et 5 % employeur. La configuration de l'organisation pour l'OMIT est actuellement à 2 % / 8 %. Ces taux sont conservés dans la version en attente, mais ils ne sont pas certifiés par un contrat ou un avis de l'OMIT ; ne pas activer avant justification.
- FMFP : 1 % employeur sur l'assiette salariale brute plafonnée, et non sur le brut non plafonné.
- Aucun bulletin historique n'est modifié. La version créée reste au statut pending_review.

Références : https://fisema.mg/fiche-salaire/ ; https://www.edbm.mg/wp-content/uploads/2017/12/Decret_2003-1162_medecine_entreprise.pdf ; https://www.fmfp.mg/faq/la-cotisation-fmfp/ ; https://www.cnaps.mg/fr/telechargement/cotisations/talonfmfp-CNaPS_600fcb8215b502.69912222.pdf
