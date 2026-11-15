# MAGNIBOX — architecture de messagerie Internet native

## Décision produit

MAGNIBOX fournit son propre service de courrier Internet. Aucun fournisseur SaaS de transport (Resend, SendGrid, Mailgun, Amazon SES ou équivalent) ne constitue une dépendance d'envoi ou de réception. Les adresses publiques restent celles des organisations et utilisateurs : `nom@domaine.tld`.

Cette décision ne signifie pas que MAGNISA devient bureau d'enregistrement de domaines. L'organisation choisit et possède son domaine auprès du registrar de son choix ; MAGNIBOX contrôle les preuves DNS et exploite le transport de courrier.

## Séparation des responsabilités

- **Application MAGNISA / Vercel** : authentification, organisations, boîtes, autorisations, interface, API métier, quotas, recherche et historique. Elle ne doit pas héberger un daemon SMTP/IMAP persistant.
- **Infrastructure MAGNIBOX dédiée** : réception SMTP sur TCP/25, soumission authentifiée sur TCP/587 (et éventuellement 465), livraison sortante SMTP, files persistantes, retry contrôlé, bounce/DSN, journaux et métriques.
- **Accès aux boîtes** : API interne sécurisée pour l'application, stockage durable des messages et pièces jointes, indexation, synchronisation et notifications. IMAP peut être proposé comme protocole de compatibilité, mais ne remplace pas l'API MAGNIBOX.
- **DNS et identité** : MX, SPF, DKIM, DMARC, TLSA/DANE si retenu, PTR/rDNS de chaque IP sortante et certificats TLS. Chaque domaine est activé uniquement après vérification et tests.
- **Sécurité opérationnelle** : antispam entrant/sortant, antivirus et limites de pièces jointes, détection d'abus, réputation IP, limitation de débit, listes de blocage, protection contre l'usurpation, isolation stricte par organisation et sauvegardes restaurables.

## Architecture de référence auto-hébergée

1. **MTA entrant/sortant** : Postfix sur des hôtes dédiés, avec files persistantes et identifiants de queue corrélés aux messages MAGNIBOX.
2. **Filtrage** : Rspamd (SPF/DKIM/DMARC, réputation et antispam), antivirus en quarantaine et politique de pièces jointes.
3. **Boîtes et accès** : Dovecot pour stockage/protocoles IMAP si nécessaire, ou service de stockage/API MAGNIBOX avec indexation. Le choix final doit être validé avec les besoins de recherche, partage, quotas et archivage.
4. **Signature** : clés DKIM séparées par domaine ou organisation, stockées hors du dépôt et de la base accessible au navigateur ; rotation et révocation prévues.
5. **Observabilité** : métriques de files, taux d'acceptation, retards, rebonds, plaintes, réputation, capacité disque et disponibilité des MX ; alertes et procédure d'incident.
6. **Haute disponibilité** : au moins deux MX dans des zones distinctes à terme, sauvegardes chiffrées, tests de restauration et plan de reprise.

## Contraintes non négociables avant l'ouverture publique

- Hébergement serveur dédié avec IP publique stable et reverse DNS modifiable.
- Vérification que l'hébergeur autorise le port TCP/25 sortant et entrant ; beaucoup de clouds le bloquent.
- PTR cohérent avec le nom HELO/EHLO et enregistrements A/AAAA.
- TLS valide, SPF/DKIM/DMARC publiés, politique de bounce et désinscription/abus opérationnelle.
- Tests réels vers et depuis Gmail, Outlook et au moins un autre domaine indépendant.
- Protection anti-open-relay : aucun relais anonyme ; authentification et autorisation obligatoires pour la soumission.
- Les changements MX ne sont jamais appliqués automatiquement. MAGNIBOX affiche les valeurs DNS et avertit qu'un MX à la racine peut détourner tous les courriers entrants du fournisseur actuel. Un sous-domaine dédié peut réduire le risque.
- Le transport reste désactivé tant que les tests, la surveillance, les limites et le plan de réponse aux abus ne sont pas validés.

## Contrat applicatif cible

Les routes métier MAGNIBOX ne doivent pas connaître un fournisseur SaaS. Elles appellent une interface interne de transport, par exemple `MagniboxMailTransport`, qui soumet un message à la file SMTP interne et renvoie un identifiant de file. Les événements de livraison, retard, rejet, bounce et plainte sont consommés depuis l'infrastructure MAGNIBOX et mettent à jour l'historique.

Le statut `accepted` signifie uniquement « accepté dans la file MAGNIBOX ». Il ne signifie pas « livré ». La livraison finale doit être confirmée par les événements ou DSN du MTA distant. Les opérations d'envoi doivent être idempotentes et ne jamais renvoyer automatiquement un message lorsque le résultat est ambigu.

## Plan de réalisation

- **Étape A — socle infra** : provisionner les hôtes, IP, PTR, stockage, réseau, pare-feu, sauvegardes et supervision ; documenter les responsabilités d'exploitation.
- **Étape B — transport natif** : déployer MTA, filtrage, DKIM, TLS, files, soumission authentifiée, réception et traitement des DSN.
- **Étape C — intégration MAGNISA** : remplacer l'adaptateur fournisseur par l'adaptateur interne ; sécuriser les API de provisioning, lecture et envoi ; conserver RLS et séparation des organisations.
- **Étape D — expérience utilisateur** : boîte de réception, dossiers, recherche, rédaction, réponses, pièces jointes, statuts et gestion des domaines.
- **Étape E — validation progressive** : tests en environnement isolé, tests aller-retour externes, pilote sur un sous-domaine, puis activation explicite par domaine.

## État actuel et limites

Le dépôt contient des tables d'identités/messages Internet et un adaptateur Resend historique. Cela ne constitue pas un serveur de messagerie auto-hébergé. La présente décision documente la cible et interdit de présenter le transport externe comme opérationnel. Aucun DNS, MX, PTR, serveur ou secret de production n'est modifié par ce document.

La capacité de livrer des messages directement depuis nos propres serveurs dépend d'une infrastructure réseau et d'exploitation réelle ; elle ne peut pas être obtenue par une simple modification du code Next.js.

## Implémentation applicative initiale

Le transport applicatif est maintenant défini comme `smtp` uniquement :
- `src/lib/orbit/transport/smtp.ts` utilise la soumission SMTP authentifiée vers l'hôte MAGNIBOX configuré, impose TLS et valide l'adresse expéditrice et la clé idempotente.
- `src/app/api/magnibox/internet/send/route.ts` enregistre d'abord la demande, vérifie les droits internes et externes, puis soumet au serveur SMTP MAGNIBOX.
- `src/app/api/internal/magnibox/inbound/route.ts` reçoit les messages filtrés du MTA MAGNIBOX via une signature HMAC horodatée, puis résout les destinataires exacts dans les identités activées. Aucun identifiant d'organisation fourni par l'appelant n'est accepté.
- L'ancien endpoint webhook tiers renvoie désormais HTTP 410 ; l'adaptateur Resend et son code de sandbox ont été retirés de cette branche.
- Les statuts `accepted` et `received` ne prétendent pas prouver la lecture par le destinataire. Le MTA doit encore publier des événements de livraison/rebond signés pour compléter les statuts.

### Variables runtime (serveur uniquement)

```dotenv
MAGNIBOX_EXTERNAL_MAIL_ENABLED=false
MAGNIBOX_SMTP_HOST=
MAGNIBOX_SMTP_PORT=587
MAGNIBOX_SMTP_SECURE=false
MAGNIBOX_SMTP_USER=
MAGNIBOX_SMTP_PASSWORD=
MAGNIBOX_SMTP_HELO=
MAGNIBOX_INBOUND_WEBHOOK_SECRET=
MAGNIBOX_OUTBOUND_DAILY_LIMIT=10
```

Ne pas placer ces secrets dans des variables `NEXT_PUBLIC_*`. Le kill switch reste à `false` tant que l'infrastructure SMTP, les DNS, les tests de livraison et les contrôles anti-abus ne sont pas terminés.

### Contrat de la passerelle entrante

Après acceptation SMTP, filtrage antispam et antivirus, le MTA POST un JSON `{ messageId, from, to, subject, text }` à `/api/internal/magnibox/inbound`. Il calcule `HMAC-SHA256(secret, timestamp + "." + rawBody)`, transmis dans `x-magnibox-timestamp` (Unix secondes) et `x-magnibox-signature: sha256=<hex>`. La passerelle rejette les signatures de plus de cinq minutes, les enveloppes trop volumineuses, les destinataires non activés et les identités dont le domaine ou l'adresse n'est plus approuvé. Les retries du MTA sont idempotents grâce à l'identifiant de message unique par identité.

### Contrat des accusés de livraison

Le serveur Postfix doit extraire le queue ID de l'acceptation SMTP (réponse `queued as`) et le conserver comme référence de livraison. L'adaptateur MAGNIBOX enregistre ce queue ID, pas seulement l'en-tête RFC Message-ID. Les événements du MTA sont POSTés à `/api/internal/magnibox/delivery-event` avec le même schéma HMAC horodaté et le JSON `{ queueId, event }`, où `event` vaut `delivered`, `bounced`, `failed` ou `deferred`. Les mises à jour ne peuvent cibler que des messages sortants par queue ID ; elles n'acceptent aucun ID d'organisation fourni par l'appelant.


### Contrat de provisionnement automatique des destinataires

`POST /api/internal/magnibox/provisioning` fournit au MTA un instantané signé en lecture seule. Le MTA envoie le corps exact `{}` avec `x-magnibox-timestamp` (Unix secondes) et `x-magnibox-signature: sha256=<hex>`, calculé sur `HMAC-SHA256(secret, timestamp + "." + rawBody)`. La réponse est signée de la même manière ; le MTA doit vérifier la signature avant d'utiliser le contenu.

L'instantané contient uniquement :
- `domains` : domaines possédant au moins une identité de réception active et approuvée ;
- `recipients` : adresses exactes actives et approuvées ;
- `generatedAt` et `revision` : date de génération et SHA-256 du couple domaines/destinataires.

Le serveur revérifie chaque identité, le statut `verified` du domaine et le statut `approved` de l'adresse dans la même organisation. Les identifiants d'organisation, IDs de boîte, mots de passe et secrets ne sont jamais renvoyés. La route est désactivée tant que `MAGNIBOX_EXTERNAL_MAIL_ENABLED` n'est pas explicitement activé et exige le secret serveur dédié `MAGNIBOX_PROVISIONING_WEBHOOK_SECRET` (au moins 32 caractères).

Cet endpoint ne crée ni ne supprime de boîte, ne change pas de statut et ne modifie aucun DNS. Le synchroniseur Postfix doit encore valider l'instantané, écrire ses cartes de domaines/destinataires de façon atomique, vérifier la configuration puis recharger Postfix dans un environnement pilote. Aucun MX client ne doit être modifié automatiquement.

### Synchronisation des cartes Postfix

Le script `infra/magnibox-mail/bridge/postfix-provision-sync.py` consomme l'instantané signé, vérifie la signature de réponse, la fraîcheur, le SHA-256 de révision, l'appartenance de chaque destinataire à un domaine autorisé et l'absence de doublons. Il génère une version immuable des cartes Postfix `domains` et `recipients`, exécute `postmap` sur la génération temporaire, puis bascule le lien `current` atomiquement vers la nouvelle révision.

Cette étape prépare les cartes, mais ne modifie pas automatiquement la configuration active et ne recharge pas Postfix. Avant toute activation, l'opérateur doit vérifier les paramètres `virtual_mailbox_domains`, `virtual_mailbox_maps` et `virtual_transport` dans un environnement pilote, contrôler les conflits avec les domaines internes DMS, puis recharger Postfix explicitement. La synchronisation ne touche jamais les comptes SMTP de soumission, les mots de passe, les DNS ou les MX.
