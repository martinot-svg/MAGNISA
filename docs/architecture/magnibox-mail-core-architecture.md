# MAGNIBOX MAIL CORE — architecture consolidée

Statut : architecture définie, implémentation progressive non activée en production.
Branche de travail : `feat/magnibox-mail-core-architecture-20261118`.

## 1. Décision d'architecture

MAGNIBOX exploite son propre transport Internet entrant et sortant. Aucun fournisseur SaaS de messagerie n'est requis dans le chemin nominal. Bird et Mailfully peuvent être retirés après validation du transport natif ; ils ne doivent pas devenir des dépendances cachées.

L'autonomie concerne le logiciel et le contrôle du transport. Elle ne rend pas gratuits l'hébergement, les adresses IP, le domaine, le stockage, le trafic réseau ou l'exploitation. La livraison aux grands fournisseurs reste soumise à leurs politiques, à la réputation IP et à la qualité DNS.

## 2. Principes structurants

1. Séparer le plan de contrôle MAGNISA du plan de données mail.
2. Ne jamais héberger de daemon SMTP/IMAP persistant dans les fonctions serverless Vercel.
3. Garder Postfix, Dovecot et les workers sur un hôte Linux dédié, durable et supervisé.
4. Utiliser une file persistante et une sémantique idempotente ; une acceptation SMTP n'est pas une preuve de livraison.
5. Ne jamais accepter de relais SMTP anonyme (open relay).
6. Vérifier les domaines, les identités et les destinataires avant toute activation.
7. Isoler strictement les données par organisation et mailbox ; appliquer RLS aux accès applicatifs.
8. Ne jamais activer automatiquement des MX client ni modifier des DNS sans approbation explicite.
9. Garder le kill switch externe désactivé jusqu'à la validation indépendante.
10. Préserver les migrations existantes et éviter toute réécriture de l'historique de schéma.

## 3. Vue logique

```text
                    MAGNISA CONTROL PLANE
       Auth / Organisations / RBAC / Domaines / Quotas
                            |
                     API privée signée
                            |
                 MAGNIBOX MAIL CORE API
          Provisioning / Submit / Inbox / Events
                            |
              +-------------+--------------+
              |                            |
       OUTBOUND PIPELINE             INBOUND PIPELINE
       API submission                Public SMTP :25
              |                            |
       Policy / quotas               Postfix MTA
              |                            |
       Persistent queue              Rspamd / SPF / DKIM /
              |                      DMARC / antivirus
       Postfix outbound                     |
              |                       Recipient resolver
       Remote MX delivery                   |
              |                      Signed inbound bridge
       DSN / bounce / defer                  |
              |                      Message persistence
       Signed delivery events               |
              +-------------+--------------+
                            |
             Message store / metadata / search
                            |
              MAGNIBOX web application / API
```

## 4. Responsabilités par couche

### 4.1 MAGNISA Control Plane

- Authentification et sessions.
- Organisations, utilisateurs, rôles et autorisations.
- Propriété et vérification des domaines.
- Identités email et association à une mailbox.
- Quotas, limites, approbations et kill switches.
- Audit des actions sensibles.

MAGNISA reste la source d'autorité pour savoir qui peut envoyer et recevoir. Le MTA ne doit pas faire confiance à un tenant ID fourni dans un message ou dans une requête non signée.

### 4.2 MAGNIBOX Mail Core API

- Provisionner/suspendre les domaines, identités et mailboxes.
- Soumettre un message après contrôles de politique.
- Lire les messages via API authentifiée.
- Recevoir les événements de livraison du MTA.
- Fournir l'état des files et les métriques d'exploitation.
- Exposer une interface de transport stable à l'application.

Les routes Next.js restent des API métier et ne sont pas le MTA.

### 4.3 Transport SMTP

- Postfix : réception TCP/25, soumission authentifiée TCP/587, livraison sortante, files persistantes et DSN.
- Dovecot : stockage/protocoles IMAP si requis ; il ne remplace pas la source de vérité MAGNISA sans décision de synchronisation explicite.
- Rspamd : réputation, filtrage, SPF/DKIM/DMARC et antispam.
- ClamAV : analyse antivirus des pièces jointes, avec quarantaine avant disponibilité.
- OpenDKIM ou mécanisme DKIM intégré au MTA : signature des domaines sortants.
- TLS : certificats valides pour les services publiés.

Les versions et images de conteneurs doivent être épinglées par version ou digest ; ne pas utiliser `:latest`.

### 4.4 Stockage et indexation

- Métadonnées, propriétaires, états, destinataires, identifiants de file et journaux : base MAGNISA.
- Corps MIME et pièces jointes : stockage privé durable, avec chiffrement et chemins non devinables.
- Index de recherche : isolé par tenant et reconstruit à partir des messages persistés.
- Pièces jointes entrantes : quarantaine obligatoire ; passage à `available` uniquement après contrôle de type, taille, hash et verdict antivirus.
- Rétention, suppression, sauvegardes et restauration : politiques explicites.

## 5. Flux de bout en bout

### 5.1 Envoi sortant

1. L'utilisateur compose un message dans MAGNIBOX.
2. L'API authentifie l'utilisateur et vérifie son rôle, son identité expéditrice et le domaine.
3. Elle valide destinataires, taille, pièces jointes, quotas et limites anti-abus.
4. Elle enregistre atomiquement la demande avec une clé idempotente.
5. Le transport interne soumet le message à Postfix via SMTP authentifié et TLS.
6. Le queue ID Postfix est enregistré et corrélé au message MAGNIBOX.
7. Les événements Postfix/DSN mettent à jour `deferred`, `delivered`, `bounced` ou `failed`.
8. Les états ambigus ne déclenchent jamais une seconde soumission aveugle.

`accepted` signifie uniquement « accepté par la file locale ». Il ne signifie pas « livré dans la boîte Gmail/Outlook ».

### 5.2 Réception entrante

1. Le DNS MX du domaine pilote dirige le courrier vers le MTA MAGNIBOX.
2. Postfix vérifie l'enveloppe et les domaines destinataires.
3. Rspamd applique les contrôles antispam et SPF/DKIM/DMARC ; les pièces jointes passent par l'analyse antivirus.
4. Le résolveur interne vérifie que chaque destinataire est actif, approuvé et rattaché à une mailbox.
5. Le bridge transmet les données au service MAGNIBOX via HTTPS avec HMAC horodaté et identifiant idempotent.
6. MAGNIBOX vérifie la signature, la fenêtre temporelle, la taille et l'état des identités avant persistance.
7. Les pièces jointes restent en quarantaine jusqu'au verdict du worker.
8. L'application expose le message à l'utilisateur autorisé.

### 5.3 Courrier interne

Les messages entre deux identités MAGNIBOX du même tenant peuvent emprunter un chemin interne sans sortie Internet, tout en conservant les contrôles d'autorisation, l'audit, les quotas et la persistance communs.

## 6. Contrats internes et sécurité

- Transport applicatif indépendant de tout fournisseur SaaS : interface `MagniboxMailTransport`.
- Authentification des appels MTA → API par HMAC SHA-256 sur horodatage et corps exact.
- Fenêtre anti-rejeu courte, taille maximale stricte, TLS obligatoire et rejet des redirections.
- Clés HMAC distinctes par usage : inbound, delivery events et provisioning.
- Aucun secret dans le navigateur, `NEXT_PUBLIC_*`, Git ou les journaux.
- Autorisation du sender basée sur l'identité validée et le domaine vérifié, pas seulement sur l'en-tête From.
- Rate limits par utilisateur, organisation, identité, IP et destination.
- Détection de comptes compromis, boucles, rafales, spam sortant et abus de pièces jointes.
- Journal d'audit append-only pour provisioning, activation, suspension et envoi.
- Révocation immédiate des identités et domaines compromis.

## 7. DNS et réputation Internet

Pour chaque domaine activé, MAGNIBOX doit afficher les valeurs attendues et vérifier :

- MX vers le MTA entrant.
- A/AAAA du nom MTA.
- PTR/rDNS cohérent avec l'identité HELO/EHLO et l'adresse IP.
- SPF limité aux serveurs autorisés.
- DKIM avec clés privées conservées uniquement sur les hôtes autorisés.
- DMARC d'abord en observation, puis politique renforcée après analyse.
- TLS valide et renouvellement automatique surveillé.
- Absence de relais ouvert et contrôles d'abus actifs.

Un hébergeur doit autoriser le TCP/25 entrant et sortant. Beaucoup de plateformes cloud le bloquent. Une IP partagée, résidentielle ou derrière CGNAT n'est pas une base adaptée à un MTA public. La réputation d'une IP neuve peut limiter la délivrabilité même si tous les tests techniques passent.

## 8. État du dépôt au démarrage du chantier

Les éléments suivants ont été retrouvés dans le dépôt et doivent être consolidés, non réécrits sans audit :

- Transport SMTP applicatif et types de messages Internet.
- Route de soumission Internet et contrôles d'autorisation.
- Route de réception interne signée HMAC.
- Route d'événements de livraison.
- Synchronisation versionnée des destinataires Postfix.
- Infrastructure Postfix/Docker Mailserver en scaffold.
- Laboratoire local Mailpit.
- Quarantaine des pièces jointes et worker d'analyse.
- Scripts de préflight hôte, antivirus et endpoints publics.

Limites constatées dans la documentation existante :

- Le scaffold mail est non déployé et les ports sont liés à loopback par défaut.
- Les tests Mailpit sont des tests locaux et ne prouvent aucune livraison Internet.
- Les cartes de domaines/destinataires et le bridge nécessitent encore une validation sur un hôte pilote.
- Le kill switch `MAGNIBOX_EXTERNAL_MAIL_ENABLED` doit rester à `false`.
- Aucun test réel Gmail/Outlook ne doit être déclaré réussi sans preuve de réception et inspection des headers/résultats.
- Les événements de livraison et les DSN doivent être vérifiés sur un MTA réellement actif.

## 9. Plan d'implémentation consolidée

### Lot 0 — Audit et gel de référence
- Relever la branche, les migrations, les routes, les schémas et les tests.
- Cartographier les flux et les secrets attendus.
- Vérifier les écarts entre documentation, code et Compose.
- Conserver les migrations déjà appliquées ; aucune modification destructive.

Critère de sortie : inventaire vérifiable et risques classés.

### Lot 1 — Contrats et modèle de données
- Stabiliser les types de messages, états, erreurs et identifiants.
- Garantir l'idempotence de soumission et de réception.
- Corréler message MAGNIBOX, queue ID Postfix et DSN.
- Vérifier RLS, index et contraintes multi-tenant.

Critère de sortie : tests unitaires et intégration locale verts.

### Lot 2 — Transport natif local
- Compose Postfix/Dovecot/Rspamd/ClamAV/Mailpit.
- Soumission authentifiée STARTTLS.
- Réception locale par Postfix et bridge signé.
- Vérification de la quarantaine et des événements de livraison.

Critère de sortie : parcours local complet, sans prétendre à Internet public.

### Lot 3 — Durcissement sécurité et exploitation
- Limites de débit, anti-open-relay, anti-abus et quotas.
- Secrets, rotation, TLS, logs expurgés et alertes.
- Sauvegarde chiffrée, restauration testée et surveillance de queue.
- Tests de pièces jointes propres et malveillantes dans un environnement isolé.

Critère de sortie : revue sécurité et plan d'incident validés.

### Lot 4 — Pilote Internet contrôlé
- Hôte Linux dédié, IP stable, PTR, TCP/25 autorisé.
- Domaine/sous-domaine pilote dont la migration est approuvée.
- DNS MX/SPF/DKIM/DMARC validés.
- Tests entrants et sortants avec Gmail, Outlook et un autre domaine.
- Vérifier headers, TLS, spam placement, DSN, retry, bounce et réputation.

Critère de sortie : preuve des deux sens, reçus par des boîtes indépendantes, et analyse des en-têtes.

### Lot 5 — Activation progressive
- Activation par domaine après approbation explicite.
- Surveillance et limites conservatrices.
- Procédure de rollback documentée.
- Deuxième MX et haute disponibilité seulement après stabilisation du premier.

Critère de sortie : approbation opérationnelle explicite ; aucun basculement automatique.

## 10. Matrice de validation obligatoire

| Contrôle | Preuve exigée |
|---|---|
| Build / types / tests | Résultats CI sur le SHA candidat |
| Replay migrations | Replay complet sur base de test propre |
| Isolation tenant | Tests RLS et tentatives cross-tenant rejetées |
| SMTP submission | TLS, authentification, sender autorisé |
| Open relay | Relais anonyme refusé |
| Inbound | Mail externe accepté puis persisté dans la bonne mailbox |
| Outbound | Mail MAGNIBOX reçu par Gmail/Outlook |
| Headers | SPF, DKIM, DMARC et Received vérifiés |
| Delivery | Queue ID corrélé au DSN et à l'état final |
| Retry | Reprise sans doublon |
| Abuse | Rate limits et suspension vérifiés |
| Backup | Restauration démontrée |
| Public endpoints | Probe externe TCP/25, 587, 993 et certificats |

## 11. Conditions de non-activation

Ne pas activer le transport public si l'un des points suivants est vrai :

- absence d'hôte dédié ou IP stable ;
- TCP/25 bloqué ou non autorisé ;
- PTR absent ou incohérent ;
- certificat TLS invalide ;
- SPF/DKIM/DMARC incomplets ;
- test open-relay non réussi ;
- absence de sauvegarde restaurable ou de surveillance ;
- réception et envoi externes non démontrés ;
- risque d'impact sur les MX existants non approuvé.

## 12. Périmètre de ce commit documentaire

Ce document définit l'architecture et le plan d'exécution. Il ne déploie aucun serveur, ne modifie aucun DNS/MX/PTR, ne change aucun secret Vercel/Supabase, ne modifie aucune base de production et ne met pas le kill switch à `true`. Les prochaines modifications de code doivent être réalisées par lots isolés, testés et revus.
