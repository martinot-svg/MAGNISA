# Décisions à valider avant implémentation

Ce document évite que l'équipe technique invente une règle métier à la place du propriétaire du produit.

| ID | Sujet | Proposition de travail | Validation requise |
|---|---|---|---|
| D-01 | Âge minimum pour créer un compte | À définir selon le cadre légal et les utilisateurs visés | Oui, bloquant |
| D-02 | Région et ville de résidence | Référentiel Madagascar distinct de l'origine d'inscription | Oui |
| D-03 | Couverture pays du téléphone | Tous pays si libphonenumber et configuration le permettent | Oui |
| D-04 | Username | 3–10 lettres minuscules, personnalisable et réservé atomiquement | Oui |
| D-05 | Username unique ou non | Unique globalement, comme le mécanisme actuel | Confirmer |
| D-06 | Données téléphone | Unicité du téléphone non imposée par défaut | Confirmer |
| D-07 | Étape complémentaire organisation | Étape dédiée après fiscalité/comptabilité et avant confirmation | Oui |
| D-08 | Numéro d'immatriculation | Définir ce que ce champ désigne et sa différence avec RCS/NIF/STAT | Oui, bloquant |
| D-09 | Régimes IR/IS | Faire valider les libellés et valeurs par un référent fiscal malgache | Oui, bloquant |
| D-10 | Effectif | Nombre exact ou tranche d'effectif | Oui |
| D-11 | Données bancaires | Saisie facultative, table séparée, accès restreint | Oui |
| D-12 | Rôles autorisés banque | Liste précise des rôles pouvant lire/modifier | Oui, bloquant |
| D-13 | Affiliations sociales | CNAPS, OSTIE, autre ; plusieurs affiliations possibles | Confirmer |
| D-14 | Rôles autorisés social | Liste précise des rôles pouvant lire/modifier | Oui, bloquant |
| D-15 | Conservation des données personnelles | Durées et règles de suppression | Oui, juridique |
| D-16 | Finances personnelles | Carte visible, désactivée « Bientôt disponible » | Confirmer |

## Règle de validation

Aucune décision marquée « bloquant » ne doit être codée avec une valeur inventée. Si elle n'est pas encore tranchée, l'interface doit permettre « À confirmer » ou différer le champ concerné.
