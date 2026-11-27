# Décisions à valider avant implémentation

Ce document évite que l'équipe technique invente une règle métier à la place du propriétaire du produit.

Les décisions D-01, D-08, D-09, D-12, D-14 et D-15 ont été validées. Leur détail normatif est centralisé dans [DECISIONS_METIER_VALIDEES.md](./DECISIONS_METIER_VALIDEES.md). Elles ne sont plus en attente de validation métier ; leur implémentation, les tests et les vérifications juridiques restent à réaliser.

| ID | Sujet | Proposition de travail / décision | Statut |
|---|---|---|---|
| D-01 | Âge minimum pour créer un compte | 18 ans minimum ; date de naissance requise, calcul automatique de l'âge et déclaration explicite de majorité. Aucun contournement par invitation. | Validée — détails dans le document de référence |
| D-02 | Région et ville de résidence | Référentiel Madagascar distinct de l'origine d'inscription | À valider |
| D-03 | Couverture pays du téléphone | Tous pays si libphonenumber et configuration le permettent | À valider |
| D-04 | Username | 3–10 lettres minuscules, personnalisable et réservé atomiquement | À valider |
| D-05 | Username unique ou non | Unique globalement, comme le mécanisme actuel | À confirmer |
| D-06 | Données téléphone | Unicité du téléphone non imposée par défaut | À confirmer |
| D-07 | Étape complémentaire organisation | Étape dédiée après fiscalité/comptabilité et avant confirmation | À valider |
| D-08 | Numéro d'immatriculation | Facultatif lors de la création de l'organisation ; pourra être renseigné ultérieurement dans les paramètres. À distinguer des identifiants fiscaux et autres numéros légaux. | Validée — détails dans le document de référence |
| D-09 | Régime fiscal | Facultatif à la création et configurable ultérieurement dans les paramètres fiscaux. Les choix doivent être adaptés au pays et à l'organisation ; IR/IS ne sont pas présumés exhaustifs. | Validée — détails dans le document de référence |
| D-10 | Effectif | Nombre exact ou tranche d'effectif | À valider |
| D-11 | Données bancaires | Saisie facultative, table séparée, accès restreint | À valider |
| D-12 | Rôles autorisés banque | Accès aux données bancaires selon le moindre privilège, avec permissions granulaires, contrôle serveur, audit et isolation par organisation. Les rôles ne donnent pas d'accès automatique. | Validée — détails dans le document de référence |
| D-13 | Affiliations sociales | CNAPS, OSTIE, autre ; plusieurs affiliations possibles | À confirmer |
| D-14 | Rôles autorisés social | Accès aux données sociales selon le moindre privilège, permissions granulaires, contrôle serveur, audit et isolation par organisation ; accès employé limité à ses propres données selon les règles définies. | Validée — détails dans le document de référence |
| D-15 | Conservation des données personnelles | Suppression ou anonymisation différenciée des données personnelles ; conservation des données organisationnelles, comptables, sociales et de sécurité uniquement lorsqu'elle est justifiée par une obligation ou une finalité légitime, avec durée adaptée. | Validée — détails dans le document de référence |
| D-16 | Finances personnelles | Carte visible, désactivée « Bientôt disponible » | À confirmer |

## Règle de validation

Aucune décision métier encore en attente ne doit être implémentée avec une valeur inventée. Si une décision n'est pas tranchée, l'interface doit permettre « À confirmer » ou différer le champ concerné.

La validation métier ne signifie pas que l'implémentation technique, les tests, la conformité juridique ou la mise en production sont terminés. Ces étapes doivent être vérifiées séparément.
