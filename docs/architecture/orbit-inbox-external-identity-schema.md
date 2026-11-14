# Magnisa Inbox — identités professionnelles publiques et autorisations

## Dépendance
La migration `20261114122000_orbit_internet_identities.sql` requiert que
`20261114120000_orbit_public_domain_requests.sql` ait été appliquée.
Il ne faut **jamais** fusionner/déployer l'interface de boîtes Internet avant
la validation de la migration, des permissions et du transport réellement branché.

## Compatibilité
- Les boîtes privées `mgmail_internal_mailboxes`, leurs délégations,
  les messages, l'authentification MAGNISA et Gmail restent inchangés.
- Un domaine peut être demandé, vérifié (propriété TXT), mais cela **n'active pas
  une boîte e-mail Internet**.
- Une vraie identité est une ressource différente d'un alias ; elle est
  associée à un domaine demandé, une adresse demandée et une boîte
  interne précise, avec des contraintes de même organisation.

## Modèle de protection
- `orbit_public_identities` : un expéditeur public unique, créé et
  activé **exclusivement côté serveur**, jamais depuis une API d'utilisateur.
  Le déclencheur rejette l'activation si le domaine n'est pas vérifié ou si
  l'adresse n'est pas approuvée. L'identifiant de domaine fournisseur et
  sa vérification sont également nécessaires.
- `orbit_external_mailbox_access` : autorisations `can_read` et `can_send`
  individuelles, chacune nécessitant **aussi** les droits correspondants
  de la boîte MGMail interne et l'appartenance active à l'entreprise.
- `orbit_external_messages` : stockage distinct des messages Internet,
  avec statuts d'acheminement et clés de déduplication ; aucun client
  ordinaire ne peut insérer ou modifier des messages ou des états de livraison.
- `orbit_can_public_mail_access` : contrôle des droits à chaque requête.
  Un membre révoqué ne doit pas accéder à la boîte via un jeton JWT ancien.
- La perte de vérification du domaine suspend les identités et stoppe
  immédiatement la réception activée, tout en **conservant l'historique**.
  Un job de réinspection DNS périodique devra déclencher cette suspension
  en cas de perte réelle de contrôle, après gestion des erreurs DNS temporaires.

## Ce qui n'est toujours pas opérationnel
Ce schéma seul ne suffit pas à envoyer/recevoir des e-mails Internet :
il manque le fournisseur configuré (un serveur SMTP/IMAP ou une API de
transport), les secrets protégés, les vérifications SPF/DKIM/DMARC,
les routes serveur pour provisionner les identités, écrire l'outbox,
valider les webhooks entrants, stocker le courrier et exposer une UI
sécurisée. La preuve DNS TXT et la signature d'un webhook ne constituent
pas une preuve de délivrabilité ; il faudra faire un aller-retour
réel avec une adresse extérieure indépendante.

## Contrôles effectués par le lot
Le replay Supabase exécute un contrat SQL d'absence de droits navigateur
et un test avec deux entreprises et plusieurs utilisateurs. Le test
vérifie l'échec d'une activation prématurée, l'affectation de permissions
propres au collaborateur, la lecture autorisée, la révocation effective,
le refus de la création de messages depuis le navigateur et la conservation
de l'historique après suspension.

## Déploiement
1. Rejeu migrations et CI complets réussis sur base jetable.
2. Revue des garanties d'activation et RLS, puis ajout explicite de
   `20261114122000` à l'allowlist.
3. Fusion sur `main`, sauvegarde chiffrée restaurée sur le SHA exact,
   préflight, puis workflow GitHub `APPLY` strictement contrôlé.
4. Vérifier ensuite le ledger et les policies réellement installées,
   sans écrire de message réel de test dans les boîtes commerciales.
5. Développer et tester les services de transport avant de publier les
   formulaires d'envoi Internet.

Sans domaine détenu et fournisseur disponible, aucune promesse de boîte
Internet fonctionnelle ou de service gratuit illimité ne doit être faite.
