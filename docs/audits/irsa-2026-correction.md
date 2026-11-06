# Correctif IRSA Madagascar 2026 - préparation isolée

## Périmètre

Cette branche prépare le barème IRSA de droit commun applicable en 2026. Elle ne modifie aucune donnée Supabase et ne change aucun bulletin déjà enregistré. Le nouveau jeu de paramètres est créé, à la demande d'un administrateur dans l'application, au statut `pending_review` avec une date de préparation au 1er novembre 2026. Il n'est jamais activé automatiquement.

## Référence fiscale

La loi n°2025-021 portant loi de finances pour 2026, article 01.03.16, fixe les taux marginaux suivants : 0 % jusqu'à 350 000 Ar, 5 % jusqu'à 400 000 Ar, 10 % jusqu'à 500 000 Ar, 15 % jusqu'à 600 000 Ar, 20 % jusqu'à 4 000 000 Ar, puis 25 % au-delà. Le texte officiel est disponible à https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf.

Le référentiel proposé reprend également le minimum de perception de 3 000 Ar et la réduction de 2 000 Ar par personne à charge au-delà de 350 000 Ar, conformément aux articles 01.03.16 et 01.03.19 du Code des impôts 2026. La base est arrondie à la centaine d'Ariary inférieure.

La loi de finances rectificative n°2026-004 est adoptée et déclarée conforme par la HCC. Le résumé public consulté ne détaille pas les éventuelles modifications article par article du CGI. La référence IRSA doit donc être relue dans la version intégrale promulguée avant toute activation.

## Date d'effet préparée

Le 1er novembre 2026 est utilisé comme date de préparation opérationnelle afin de ne pas recalculer rétroactivement les périodes antérieures ni modifier les bulletins déjà établis. Cette date n'affirme pas que la loi fiscale est entrée en vigueur à cette date : le barème légal 2026 est celui de la loi de finances initiale. Les périodes antérieures restent dans leur historique.

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
