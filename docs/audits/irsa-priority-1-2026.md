# Priorité 1 MAGNISA — vérification réglementaire IRSA 2026

## Sources officielles contrôlées

5. Plan Comptable Général 2005 publié par le Ministère chargé des Finances : https://www.mef.gov.mg/csc/ckfinder/userfiles/files/plan-comptable-general-2005.pdf

1. Loi n° 2025-021 portant loi de finances pour 2026 : https://cnlegis.gov.mg/uploads/L2025-021_VF.pdf
2. Loi n° 2026-004 portant loi de finances rectificative pour 2026 : https://cnlegis.gov.mg/uploads/L2026-004-VF.pdf
3. Code des impôts publié par la DGI en 2025 : https://portal.impots.mg/textes/textes/2025-02-06--N-2025-MEF.SG.DGI-Ref-HIH9EC-3OPLT3.pdf
4. Décision n°02-MEF/SG/DGI/DLFC du 11 octobre 2019 sur l'exonération IRSA des heures supplémentaires : https://portal.impots.mg/textes/textes/2019-10-11--N-02-MEF.SG.DGI.DLFC-Ref-K49HU4-FFPKVG.pdf

## Résultat de la confrontation LFR 2026

Le texte intégral promulgué de la loi n°2026-004 a été ouvert sur CNLegis et ses dispositions fiscales ont été parcourues (pages 19 à 34 du PDF).

- Les modifications du Code des impôts listées par la LFR concernent notamment les articles 01.01.03, 01.01.05, 01.01.11, 01.01.13, 01.01.14, 01.01.19, 01.01.27, 01.01.29, 01.01.30, 01.02.07 bis, 01.04.02 et 01.04.10.
- Aucune modification directe des articles IRSA 01.03.02, 01.03.03, 01.03.07, 01.03.08, 01.03.09, 01.03.16 ou 01.03.19 n'est listée dans les dispositions opératoires de la LFR.
- L'article VII-32 du Code des procédures fiscales est complété : le montant de l'impôt à payer après liquidation est arrondi à la centaine d'Ariary immédiatement inférieure, sauf multiple exact de 100. C'est un arrondi du montant à payer au stade de la déclaration/du recouvrement, distinct de l'arrondi de l'assiette IRSA prévu par l'article 01.03.16. Il ne faut pas appliquer ce second arrondi à chaque bulletin individuel sans fondement spécifique ; le traitement doit être porté au niveau du total déclaré à payer.

## Règles IRSA confirmées pour le droit commun

### Champ imposable et exonérations

- CGI 01.03.02 : salaires, traitements, primes et gratifications, mois supplémentaires et indemnités ayant le caractère de complément de salaire sont imposables.
- CGI 01.03.03 : exonérations spécifiques, notamment certaines pensions et indemnités, certains avantages en nature et les rémunérations des heures supplémentaires dans la limite légale de 20 heures, sous les conditions précisées par décision DGI.
- CGI 01.03.07 : les salaires, indemnités et avantages en nature concourent à la base imposable ; l'impôt légalement dû par le salarié et pris en charge par l'employeur constitue un avantage imposable.
- CGI 01.03.08 : valorisation légale des avantages en nature : véhicule 15 % des dépenses mensuelles réelles visées, logement 50 % du loyer réel ou valeur locative mensuelle avec plafond de 25 % des rémunérations fixes en numéraire, téléphone 15 % des dépenses mensuelles réelles, autres avantages à leur valeur réelle. Les retenues salariales sur ces avantages réduisent leur valeur imposable dans la limite de celle-ci.

### Déductions du revenu brut

CGI 01.03.09 :
- Cotisations salariales et versements personnels destinés à constituer une pension/retraite : déductibles dans la limite de 10 % de la partie brute des appointements soumis à retenue ou donnant lieu à versement, sous réserve des conditions du texte.
- Cotisation ouvrière à une organisation sanitaire d'entreprise ou assurance santé : déductible dans la limite de 2 % du salaire brut.
- Les autres déductions prévues au paragraphe 5 sont soumises à justificatifs et à demande dans les délais légaux ; elles ne doivent pas être activées automatiquement dans une retenue mensuelle sans notification ou fondement requis.

### Barème, minimum et réduction

La loi n°2025-021 pour 2026 fixe le barème progressif de droit commun :
- 0 % jusqu'à 350 000 Ar ;
- 5 % de 350 001 à 400 000 Ar ;
- 10 % de 400 001 à 500 000 Ar ;
- 15 % de 500 001 à 600 000 Ar ;
- 20 % de 600 001 à 4 000 000 Ar ;
- 25 % au-delà de 4 000 000 Ar.

L'article 01.03.16 conserve le minimum d'impôt de 3 000 Ar et l'arrondi de l'assiette à la centaine d'Ariary inférieure. L'article 01.03.19 prévoit une réduction mensuelle de 2 000 Ar par personne à charge pour un revenu imposable supérieur à 350 000 Ar, sans ramener l'impôt sous le minimum. L'éligibilité des personnes à charge doit respecter les critères du même article et l'attribution des allocations familiales.

### Heures supplémentaires

La décision n°02-MEF/SG/DGI/DLFC du 11 octobre 2019 précise :
- l'exonération porte sur les 20 premières heures supplémentaires de chaque mois ;
- elle ne s'applique pas au personnel cadre ;
- la quote-part exonérée comprend le salaire horaire effectif et la majoration d'heures supplémentaires, mais exclut les primes et autres majorations additionnelles ;
- l'employeur doit tenir un relevé mensuel détaillé et cohérent avec le bulletin signé ;
- la déclaration mensuelle doit comporter une annexe détaillant les heures et montants exonérés et imposables.

Sans relevé rapproché, l'exonération n'est pas appliquée.

## Modifications logicielles de cette branche

- Réduction IRSA pour personnes à charge et seuil désormais versionnés.
- Plafond de déduction retraite à 10 % versionné et appliqué dans les calculateurs TypeScript et SQL.
- Cotisation salariale de retraite complémentaire ajoutée au brouillon et au bulletin, déduite du net et déductible de l'assiette IRSA dans la limite de 10 %.
- Écriture comptable distincte de dette envers l'organisme pour la cotisation salariale de retraite complémentaire.
- Moteur de classification fiscale datée ajouté dans `irsa-compensation.ts`, avec rejet des classifications absentes ou ambiguës.
- Moteur spécifique d'exonération des heures supplémentaires ajouté avec contrôle des cadres, des 20 heures, des justificatifs et des primes additionnelles.

## Limites non clôturées

- Le moteur de classification par élément est ajouté comme composant testable, mais son branchement complet sur tous les éléments réels de rémunération, les justificatifs et le moteur SQL reste à terminer.
- Les champs détaillés d'heures supplémentaires (nombre d'heures, taux horaire, majoration, statut cadre et référence du relevé rapproché) ne sont pas encore intégrés au flux complet de saisie du bulletin ; l'exonération ne doit donc pas être activée dans les bulletins tant que ces données ne sont pas persistées et contrôlées.
- Le texte LFR ne modifie pas directement les articles IRSA cités, mais son arrondi du montant déclaré à payer doit être intégré au calcul agrégé de déclaration, pas au montant de chaque bulletin.
- Les déductions annuelles soumises à demande/notification ne sont pas automatisées dans le calcul mensuel.

## Protection des historiques

La migration proposée est additive : nouvelles colonnes avec valeurs historiques par défaut, aucune mise à jour des deux bulletins déjà payés, aucune réécriture de bulletins clôturés. La migration n'est pas appliquée à Supabase Production tant que le replay SQL, les tests et la vérification de compatibilité ne sont pas réussis.
