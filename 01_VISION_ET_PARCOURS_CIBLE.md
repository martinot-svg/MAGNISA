# 01 — Vision et parcours cible

## 1. Principes produit

1. Un utilisateur possède un compte personnel MAGNISA unique.
2. Ce compte peut créer plusieurs organisations et rejoindre plusieurs équipes.
3. Le compte personnel n'est pas confondu avec le profil professionnel dans une organisation.
4. Les informations personnelles restent séparées des informations de l'organisation.
5. Chaque organisation possède ses propres données, paramètres, membres et rôles.
6. Les données facultatives peuvent être complétées après la création.
7. Une étape facultative ne doit jamais bloquer la création d'une organisation.
8. Les informations bancaires et sociales sont sensibles et ne doivent pas être exposées aux membres sans autorisation métier.

## 2. Parcours d'inscription cible

| Phase | Écran | Objectif |
|---|---|---|
| 1 | Créer votre espace personnel | Saisir l'identité, le nom d'utilisateur, e-mail, téléphone, date de naissance et résidence |
| 2 | Sécuriser votre compte | Définir et confirmer le mot de passe |
| 3 | Vérifier votre adresse e-mail | Vérifier l'e-mail avec le code à six chiffres |
| 4 | Choisir votre utilisation de MAGNISA | Créer un espace pour une organisation, rejoindre une équipe ou consulter l'option finances personnelles à venir |

Après la phase 4 :
- Créer une organisation → wizard de création.
- Rejoindre une équipe → invitations disponibles pour le compte.
- Finances personnelles → carte visible, désactivée, mention « Bientôt disponible ».

## 3. Parcours de création d'organisation cible

Conserver le wizard existant et son ordre de base. Ajouter une étape « Informations complémentaires » facultative. Proposition d'ordre recommandé :

1. Identité de l'organisation.
2. Situation juridique.
3. Localisation et contacts.
4. Fiscalité et comptabilité.
5. Informations complémentaires (facultatif).
6. Vérification et création.

La sixième étape est une proposition de cible fonctionnelle. L'intégration exacte doit être confirmée avant de modifier les indices d'étapes, les tests et les liens de navigation.

## 4. Expérience de l'étape facultative

Titre : **Informations complémentaires**

Texte d'introduction :
« Vous pouvez renseigner ces informations maintenant ou les compléter plus tard dans les paramètres de votre organisation. »

Aucun astérisque ne doit être affiché. Ne pas répéter « facultatif » dans chaque libellé.

Actions :
- **Ignorer cette étape**
- **Enregistrer et continuer**

Comportement :
- Ignorer : conserve les données déjà saisies, marque l'étape comme ignorée/non renseignée et passe à la confirmation.
- Enregistrer et continuer : valide les champs fournis, sauvegarde le brouillon si le mécanisme de brouillon existe, puis continue.
- Un champ vide ne doit pas être transformé en valeur fictive.
- Les champs incomplets ne bloquent pas l'utilisateur, sauf incohérence d'un champ qu'il a commencé à remplir (ex. numéro bancaire partiel).
- L'utilisateur pourra compléter ou corriger les données dans les paramètres, selon les permissions.

## 5. Fin de création

Après création réussie :
- afficher le nom de l'organisation ;
- confirmer que le créateur est Administrateur principal selon le mécanisme existant ;
- afficher l'état de traitement du logo séparément ;
- proposer d'ouvrir le tableau de bord et les paramètres ;
- ne pas refaire la création si le chargement du logo échoue ;
- conserver la possibilité de réessayer l'import du logo sans créer une seconde organisation.

## 6. États de l'interface

Tous les écrans doivent prévoir :
- chargement ;
- validation en cours ;
- erreur de validation ;
- erreur serveur ;
- indisponibilité réseau ;
- succès ;
- retour arrière sans perte des données déjà saisies ;
- état désactivé ;
- navigation clavier ;
- affichage mobile sans débordement horizontal.
