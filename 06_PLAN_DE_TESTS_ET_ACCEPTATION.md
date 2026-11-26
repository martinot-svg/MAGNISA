# 06 — Plan de tests et critères d'acceptation

## 1. Tests compte personnel

### Formulaire
- Prénom vide/refusé.
- Nom vide/refusé.
- E-mail mal formé/refusé.
- Téléphone valide et invalide.
- Indicatif Madagascar par défaut.
- Indicatif étranger accepté si pris en charge.
- Date de naissance future/refusée.
- Date de naissance sous l'âge minimum/refusée selon décision validée.
- Région et localité de résidence cohérentes.
- Changement de région réinitialise la localité.
- Localité inconnue gérée sans attribution géographique inventée.

### Username
- Génération depuis prénom/nom.
- Modification manuelle.
- 2 lettres/refusé si règle cible 3 minimum.
- 11 lettres/refusé.
- majuscules normalisées ou refusées selon contrat.
- caractères accentués normalisés.
- conflit d'unicité.
- deux inscriptions concurrentes.
- affichage de la valeur effectivement persistée.
- anciens usernames toujours acceptés à la connexion.

### Auth et OTP
- Mot de passe trop court.
- Confirmation différente.
- Création Auth réussie.
- Création Auth échouée.
- Code valide.
- Code erroné.
- Code expiré.
- renvoi avant délai.
- renvoi après délai.
- limitation d'essais.
- accès protégé refusé avant vérification.
- connexion après vérification.
- pas de mot de passe dans `profiles`, logs ou analytics.

## 2. Tests de séparation des données

- Origine d'inscription inchangée après mise à jour de résidence.
- Résidence modifiable sans altérer `private.magnisa_identity_mapping`.
- Origine non visible depuis une session utilisateur normale.
- Origine non visible par un admin d'organisation.
- Aucun code géographique dans les Auth metadata/JWT.
- Identifiant public 14 chiffres inchangé.

## 3. Tests du choix d'utilisation

- Carte créer organisation active.
- Carte rejoindre équipe active.
- Carte finances personnelles visible et désactivée.
- Changement de choix sans suppression d'adhésion.
- Utilisateur ayant plusieurs organisations redirigé vers le sélecteur existant.
- Invitation invalide/expirée/refusée côté serveur.
- Invitation d'un autre e-mail non consommable.

## 4. Tests wizard organisation

- Navigation avant/arrière sans perte de saisie.
- Validation des champs obligatoires existants.
- Secteur et activité principale cohérents.
- Activités secondaires sans doublon.
- Forme juridique et statut enregistrés.
- NIF/STAT/RCS réutilisés, pas dupliqués.
- Adresse d'organisation indépendante de la résidence personnelle.
- Date exercice valide.
- Fin d'exercice après début.
- Régime fiscal « à confirmer » possible.
- Création organisation transactionnelle.
- Créateur devient Administrateur principal selon la fonction existante.
- Création multiple selon la règle produit.
- Échec upload logo ne crée pas une seconde organisation.
- Réessai logo fonctionne.

## 5. Tests de l'étape complémentaire

- Étape entièrement vide ignorée.
- Enregistrer et continuer avec un champ renseigné.
- Date d'immatriculation invalide.
- Effectif négatif ou décimal refusé.
- Numéro bancaire partiel signalé.
- Plusieurs affiliations sociales.
- Organisme « autre » exige son libellé.
- Aucun document juridique demandé.
- Données accessibles uniquement aux rôles autorisés.
- Données bancaires masquées dans les réponses API non autorisées.
- Les données bancaires ne figurent pas dans `onboarding_profile`.

## 6. Tests de sécurité organisationnelle

Exécuter les scénarios avec :
- anon ;
- utilisateur authentifié sans organisation ;
- membre actif standard ;
- manager ;
- admin ;
- owner ;
- utilisateur d'une autre organisation ;
- utilisateur suspendu ;
- invitation en attente.

Vérifier :
- lecture ;
- insertion ;
- mise à jour ;
- suppression ;
- accès RPC ;
- accès Storage ;
- accès aux informations bancaires/sociales ;
- absence de fuite inter-organisation.

## 7. Tests UI/UX et accessibilité

- mobile étroit ;
- tablette ;
- desktop ;
- navigation clavier ;
- labels associés aux champs ;
- erreurs annoncées aux lecteurs d'écran ;
- focus visible ;
- contraste WCAG 2.2 AA ;
- zones tactiles utilisables ;
- aucune information indiquée uniquement par la couleur ;
- respect de `prefers-reduced-motion` ;
- aucun débordement horizontal.

## 8. Gate de livraison

Une phase n'est terminée que si :
- tests unitaires réussis ;
- tests serveur/RPC réussis ;
- tests RLS réussis ;
- parcours manuel réussi ;
- non-régression réussie ;
- revue de code faite ;
- migration testée sur environnement non-production ;
- aucune erreur critique ou fuite de données ;
- critères d'acceptation documentés.
