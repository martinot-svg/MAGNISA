# MAGNIBOX — architecture de synchronisation Supabase / IMAP et préparation MTA public

Statut : conception et préparation uniquement. Aucun serveur public, DNS, MX, secret de production ou drapeau d'activation n'est modifié par ce document.

## 1. Décision d'architecture

**Supabase est la source de vérité de la boîte MAGNIBOX.** Dovecot n'est pas un second stockage maître. Il expose une projection IMAP des messages et états MAGNIBOX, sur le MTA contrôlé par MAGNIBOX.

Ne pas faire de réplication bidirectionnelle brute entre une table Supabase et un Maildir : les deux systèmes n'ont ni transaction distribuée, ni identifiants natifs communs, et les conflits de déplacement/suppression seraient ambigus.

Le modèle recommandé est un adaptateur IMAP avec boîte aux lettres logique :
- chaque message applicatif possède un identifiant MAGNIBOX stable ;
- chaque boîte IMAP conserve un mapping stable (mailbox_id, message_id, UIDVALIDITY, UID) ;
- les flags IMAP (\\Seen, \\Flagged, \\Answered, \\Draft) et les opérations de dossiers sont traduits en commandes applicatives idempotentes ;
- les changements venant de l'application sont projetés vers IMAP via une outbox transactionnelle ;
- les changements IMAP sont reçus comme commandes authentifiées, validées par l'API MAGNIBOX, puis persistés dans Supabase avant accusé de réception ;
- les suppressions sont des tombstones versionnés avant purge différée ; jamais de suppression immédiate irréversible sur une simple notification IMAP ;
- pièces jointes et corps volumineux restent dans le stockage privé MAGNIBOX ; l'IMAP reçoit une représentation MIME contrôlée générée à la demande ou mise en cache.

## 2. Contrat de synchronisation

Chaque opération porte :
- tenant/organization_id et mailbox_id résolus côté serveur ;
- message_id MAGNIBOX, jamais un identifiant fourni librement par le client ;
- operation_id UUID idempotent ;
- version monotone par message ou boîte ;
- source (app ou imap), horodatage serveur et payload validé.

Règles :
1. Les écritures d'application modifient Supabase et ajoutent l'événement outbox dans la même transaction PostgreSQL.
2. Le worker consomme l'outbox avec verrouillage/lease, applique la projection IMAP et marque l'événement terminé seulement après confirmation.
3. Une répétition du même operation_id est sans effet ; un operation_id réutilisé avec un payload différent est rejeté.
4. Les commandes IMAP sont authentifiées, autorisées au niveau de l'organisation et converties en mutations Supabase avant confirmation.
5. Les conflits de versions retournent une réponse de conflit et sont réconciliés depuis l'état Supabase ; pas de last-write-wins silencieux.
6. Les UID IMAP ne sont jamais utilisés comme identifiants globaux ; UIDVALIDITY change si une boîte doit être reconstruite.
7. Les suppressions IMAP deviennent des tombstones synchronisées et une purge différée après fenêtre de récupération.
8. Les événements échoués après les tentatives configurées passent en dead-letter avec alerte et possibilité de rejeu contrôlé.

## 3. Séquence de réalisation avant le code de synchronisation

- [ ] Inventorier les tables existantes de messages, identités, dossiers, pièces jointes et statuts.
- [ ] Confirmer les contraintes uniques, RLS, triggers et politiques Storage.
- [ ] Définir le mapping mailbox/message/UID et la stratégie UIDVALIDITY.
- [ ] Ajouter migration outbox + mapping IMAP + tombstones, avec RLS stricte et accès worker uniquement.
- [ ] Ajouter fonctions transactionnelles pour mutation + outbox.
- [ ] Implémenter worker avec lease, retry exponentiel, idempotence et dead-letter.
- [ ] Implémenter adaptateur Dovecot/IMAP ou backend IMAP compatible qui consomme la projection ; ne pas écrire directement dans Maildir en parallèle de Dovecot.
- [ ] Couvrir APPEND, FETCH, STORE flags, MOVE/COPY, EXPUNGE, création/renommage de dossiers et reconnexion.
- [ ] Tester crash avant/après projection, répétition, ordre inversé, conflits, multi-tenant et restauration.
- [ ] Démontrer qu'un message entrant Postfix visible dans Supabase est aussi visible en IMAP, puis qu'un flag IMAP revient dans Supabase.

**Gate :** tant que cette suite n'est pas passée sur Supabase local isolé et Dovecot de test, ne pas annoncer la synchronisation active.

## 4. Préparation du MTA public — sans exposition

Les fichiers Compose restent liés à 127.0.0.1 par défaut. Garder ce réglage. Avant toute ouverture :
- hôte Linux dédié, IPv4 publique fixe et PTR modifiable ;
- confirmation écrite de l'hébergeur : TCP/25 entrant et sortant autorisés ;
- FQDN mail dédié, A/PTR cohérents et certificat TLS valide ;
- MX du domaine pilote uniquement après approbation explicite ;
- SPF minimal autorisant uniquement le MTA pilote ;
- DKIM généré sur l'hôte, clé privée non exportée vers Git ou navigateur, publication du TXT public ;
- DMARC d'abord en observation (p=none), rapports contrôlés avant durcissement ;
- ports limités à 25, 587 et éventuellement 993 selon le besoin ; administration non exposée ;
- Rspamd, ClamAV, limites, rate limiting, authentification, Fail2ban, supervision des queues, postmaster/abuse, sauvegardes chiffrées et restauration testée ;
- test externe depuis un réseau indépendant, puis campagne de délivrabilité et analyse des rebonds.

Ne pas utiliser un domaine client en production pour les premiers essais : préférer un sous-domaine pilote dédié. Ne jamais remplacer un MX existant sans validation explicite du propriétaire.

## 5. Gmail et Outlook — plan de validation après provisionnement

Campagne contrôlée, avec boîtes de test autorisées :
1. MAGNIBOX → Gmail : livraison, SPF, DKIM, DMARC, TLS, From/Return-Path et traitement des rebonds.
2. MAGNIBOX → Outlook : mêmes contrôles.
3. Gmail → MAGNIBOX : réception TCP/25, validation MX, anti-spam, signature de passerelle, persistance unique et apparition dans IMAP.
4. Outlook → MAGNIBOX : mêmes contrôles.
5. Répondre, transférer, joindre un fichier de test inoffensif, marquer lu/non lu, déplacer et supprimer ; vérifier la cohérence app/IMAP.
6. Tester retry, doublons, Message-ID collision, panne temporaire, quota, rejet permanent et restauration.
7. Conserver les preuves horodatées (queue ID, message ID, résultats DNS/TLS, journaux expurgés) sans stocker de secrets.

SMTP 250 ou acceptation en file n'est pas une preuve de livraison dans la boîte du destinataire. La réussite nécessite une confirmation de réception côté boîte externe et une inspection des événements de livraison.

## 6. État actuel et limites

- Le bridge entrant signé et les contrôles d'idempotence sont présents dans le code et leurs tests CI passent.
- Le laboratoire local Postfix → Mailpit et le test Dovecot IMAPS (TLS, login, LIST, APPEND, SEARCH, FETCH) passent dans le dernier workflow confirmé.
- Ce test Dovecot écrit et relit dans le Maildir de test ; il ne valide pas la synchronisation de l'inbox Supabase.
- Le replay des migrations locales et les contrôles de schéma ont passé leurs étapes ; le workflow global peut encore exécuter d'autres tests.
- Aucun hôte public, IP fixe, DNS, PTR, MX, port public, secret de production ou test Gmail/Outlook n'est confirmé ici.

**Ne pas activer** `MAGNIBOX_EXTERNAL_MAIL_ENABLED`, ne pas publier les ports et ne pas modifier de MX avant la validation indépendante de tous les gates ci-dessus.
