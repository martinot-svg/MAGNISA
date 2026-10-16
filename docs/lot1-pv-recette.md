# MAGNISA — Lot 1 — Procès-verbal de recette applicative (provisoire)
Date : 2026-10-16
Environnement : MAGNISA-TEST (Supabase `jrotsmzkyjsibmbnqxtz`)
Application : Vercel Preview de `lot1-securite-financiere`
Production : hors périmètre, interdiction de fusionner vers `main` à ce stade.

## Faits vérifiés

- [x] Nouveau projet Supabase distinct de la production.
- [x] Reproduction structurelle : 47 tables, 121 politiques RLS (adaptations de migrations historiques documentées dans le suivi).
- [x] Sept migrations lot1 appliquées sur la base isolée et versionnées dans `supabase/migrations/20261016090000_lot1_financial_safety.sql`.
- [x] Privilèges `TRUNCATE` révoqués pour `authenticated` sur les tables financières testées.
- [x] Création sécurisée de compte financier via procédure `lot1_create_financial_account`.
- [x] Paiement répété : 1 paiement, 1 mouvement, soldes justes.
- [x] Deux appels SQL de paiement lancés en parallèle avec même clé : même UUID retourné, un paiement créé.
- [x] Dépense répétée et transfert répété : un seul effet financier.
- [x] Clé réutilisée avec un montant différent : rejet.
- [x] Identités Auth fictives avec contexte JWT PostgreSQL simulé : accès à une autre organisation refusé ; rôle commercial incapable de créer un compte financier.
- [x] GitHub : changements isolés dans `lot1-securite-financiere`.
- [x] Variables Vercel Supabase et URL d'application limitées à la branche `lot1-securite-financiere`.
- [x] Build Vercel Preview **READY** ; pages de connexion et de gestion incluses dans le build.

## Limites (non validés)
- [ ] Auth réelle via Supabase GoTrue avec jeton signé et cookies SSR ; les SQL SET ROLE / request.jwt.claim.sub sont des simulations du contexte JWT.
- [ ] Navigateur interactif : inscription, OTP, connexion, onboarding, création de compte, facture, paiement et contrôle des messages.
- [ ] Résultat vérifié des requêtes runtime Preview sous session authentifiée (non déduit du seul succès de build).
- [x] Deux demandes simultanées avec clés différentes de 60 MGA sur solde restant 75 MGA : 1 acceptée, seconde rejetée, 15 MGA restants.
- [ ] Tests de navigateur sur mobile et desktop, accessibilité et erreurs réseau.
- [x] Nettoyage réussi : suppression ordonnée des dépendances, organisation et identité fictives ; 0 organisation, 0 paiement, 0 mouvement, 0 audit, 0 utilisateur fictif ; audit trigger actif.
- [ ] Test indépendant d'éventuelles autres dépendances du projet (Mail, callbacks, domaine de redirection).
- [ ] Sauvegarde/restauration et stratégie de retour arrière production.

## Protection de la production
- Ne jamais modifier les variables Vercel ayant `target: production`.
- Ne pas utiliser le Preview générique sans contrôler la branche : il peut hériter du Supabase de production.
- Ne pas merger les migrations depuis la branche tant que les tests restants n'ont pas abouti.
- Ne pas envoyer de véritables messages e-mail lors de tests d'OTP sauf avec adresses approuvées.
- Ne jamais reproduire les données clients/financières de production dans le projet de test.

## Exécution manuelle de bout en bout (reste à faire)
1. Ouvrir l'URL Preview dédiée de la branche : https://magnisa-git-lot1-securite-financiere-magnisa.vercel.app .
2. Vérifier les valeurs effectives de configuration du déploiement et l'Auth redirect URL Supabase-TEST.
3. Utiliser une adresse e-mail de test contrôlée, réaliser signup / vérification / sign-in.
4. Créer deux organisations et deux comptes de test avec rôles différents ; confirmer séparation serveur.
5. Créer client, prestation, devis, facture émise puis paiement 1 fois et double soumission.
6. Contrôler soldes, créance, journal financier, écritures et audit.
7. Enregistrer dépense et transfert ; vérifier absence de double comptage.
8. Valider les erreurs (montant supérieur à la dette, absence de permission, montant négatif, compte d'autre entreprise).
9. Contrôler l'interface en affichage mobile et les états vides.
10. Nettoyer les données d'essai par procédure contrôlée, conserver traces de recette et rapport.

Décision : **non prêt pour promotion production** tant que la recette Auth+navigateur n'est pas approuvée.

## Complément de recette — 2026-10-16
- Deux appels concurrents avec même clé : UUID de paiement identique, un seul paiement créé.
- Deux appels concurrents avec clés distinctes : une tentative bloquée par solde restant insuffisant.
- Suppression des fixtures confirmée : MAGNISA-TEST est vide de toute donnée métier de recette et de son utilisateur temporaire.
- Les media queries CSS à 980 et 620 px existent, mais l'affichage responsive n'a pas été testé dans un navigateur.
- Le navigateur réel, OTP e-mail, jetons Auth signés, cookies SSR et parcours des formulaires restent non validés ; pas de navigateur pilotable ni accès HTTP externe dans la session.
- Les anciennes RPC sous-jacentes disposent potentiellement de leurs droits EXECUTE historiques : l'idempotence n'est pas universelle tant que toutes les voies d'écriture ne sont pas auditées.
- Ne pas fusionner la branche ni appliquer les migrations en production sans recette bout en bout.
