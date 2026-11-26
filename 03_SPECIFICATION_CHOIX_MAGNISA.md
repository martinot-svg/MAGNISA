# 03 — Choix de l'utilisation de MAGNISA

## Écran

Titre : **Comment souhaitez-vous utiliser MAGNISA ?**

Sous-titre :
« Choisissez l'espace qui correspond à votre besoin. Vous pourrez changer de choix plus tard. »

## Carte 1 — Créer un espace pour mon organisation

Description :
« Créez un espace professionnel pour gérer les activités, les informations administratives, les équipes et les opérations de votre organisation. »

Action : **Créer un espace**

Destination : route de création existante `/creer-entreprise` (vérifier la route réelle avant modification).

Comportement :
- Ouvrir le wizard de création existant.
- Un compte peut créer plusieurs organisations si les règles métier et permissions le permettent.
- Le rôle initial est déterminé par le mécanisme SQL existant ; ne pas l'assigner uniquement côté client.

## Carte 2 — Rejoindre une équipe

Description :
« Accédez à une organisation en acceptant une invitation envoyée par son administrateur. »

Action : **Rejoindre une équipe**

Destination : espace des invitations existant, actuellement référencé par `/espace-personnel#invitations`.

Comportement :
- Lister uniquement les invitations destinées au compte connecté.
- Vérifier l'e-mail destinataire, le jeton, la date d'expiration, l'état et l'organisation côté serveur.
- Une invitation ne peut être consommée qu'une fois.
- L'utilisateur voit clairement l'organisation et le rôle proposé avant d'accepter.
- Le rôle effectif doit provenir de l'invitation validée côté serveur.
- L'acceptation crée/active l'adhésion selon la fonction existante.
- Aucun accès à une organisation avant acceptation valide.

## Carte 3 — Gérer mes finances personnelles

Description :
« Un espace personnel pour suivre et organiser vos finances au quotidien. »

État : **Bientôt disponible**

Comportement :
- Carte visible pour signaler la fonctionnalité à venir.
- Action désactivée ; aucune route fonctionnelle ne doit être appelée.
- Mention textuelle « Bientôt disponible ».
- L'état ne doit pas être communiqué uniquement par la couleur.
- Ne pas créer de fausse page ou de fausse fonctionnalité.

## Règles transversales

- Les trois cartes doivent être cohérentes visuellement et accessibles.
- Le choix d'une carte ne supprime pas le compte personnel.
- Le choix peut être changé plus tard.
- Les adhésions existantes ne sont jamais supprimées lors d'un changement de choix.
- Si l'utilisateur a déjà une ou plusieurs organisations, proposer le sélecteur d'organisation existant plutôt que de le renvoyer systématiquement au premier écran.
- Aucun compte personnel n'est automatiquement administrateur de toutes les organisations.

## Critères d'acceptation

- Les trois choix sont clairement nommés.
- « Finances personnelles » est visible mais inactif.
- « Créer un espace » ouvre le wizard existant.
- « Rejoindre une équipe » ouvre les invitations du compte.
- L'utilisateur peut revenir à cet écran plus tard.
