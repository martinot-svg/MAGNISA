# 07 — Déploiement, surveillance et retour arrière

## 1. Environnements

Déployer dans cet ordre :
1. environnement local de développement ;
2. environnement de préproduction/staging ;
3. production.

Ne pas appliquer une migration directement en production sans validation staging.

## 2. Séquence de release

1. Finaliser l'audit du schéma et des dépendances.
2. Créer une branche dédiée.
3. Ajouter les migrations additives et compatibles.
4. Tester les migrations sur une copie/staging.
5. Déployer les fonctions serveur compatibles.
6. Déployer l'interface avec feature flag si disponible.
7. Activer le nouveau parcours pour un groupe limité ou une période contrôlée.
8. Vérifier les métriques et les erreurs.
9. Étendre progressivement.
10. Consigner le commit, les migrations et les résultats.

## 3. Surveillance

Surveiller sans collecter de données personnelles inutiles :
- taux d'échec signup ;
- taux de réussite OTP ;
- erreurs de génération/réservation username ;
- erreurs d'enregistrement de résidence ;
- taux d'abandon par étape ;
- erreurs de validation organisation ;
- erreurs RPC de création ;
- échecs de stockage logo ;
- refus RLS attendus ;
- latence des opérations.

Ne jamais écrire les mots de passe, codes OTP, RIB ou numéros de compte dans les logs.

## 4. Retour arrière

Le retour arrière doit privilégier :
- désactivation du feature flag ;
- retour de l'interface à la route précédente ;
- conservation des colonnes additives ;
- correctif forward-only si des données ont déjà été écrites.

Ne pas supprimer les colonnes nouvellement créées en production si elles contiennent des données. Ne pas revenir en arrière par `DROP` sans analyse.

## 5. Incidents

En cas de problème :
- arrêter l'activation progressive ;
- conserver les logs techniques expurgés ;
- vérifier Auth, RPC, RLS et Storage ;
- identifier si l'incident touche les nouveaux comptes, les anciens comptes ou les organisations existantes ;
- corriger en avant ;
- documenter la cause et la non-régression ajoutée.
