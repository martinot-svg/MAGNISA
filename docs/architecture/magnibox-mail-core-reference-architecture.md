# MAGNIBOX MAIL CORE — Architecture de référence

- Statut : décision d'architecture / RFC
- Date : 2026-11-18
- Branche : `feat/magnibox-mail-core-architecture-20261118`
- Portée : architecture cible et séquencement ; aucun déploiement réseau ou changement DNS

## 1. Décision

MAGNIBOX exploite son propre transport de courrier électronique. Aucun fournisseur SaaS de transport (Bird, Mailfully, Resend, SendGrid, Mailgun, SES ou équivalent) n'est requis pour le fonctionnement normal.

« Autonome » signifie que MAGNIBOX contrôle ses MTA, ses files, son filtrage, ses clés de signature, ses boîtes et ses événements. Cela ne signifie pas que le service public est sans coût : un domaine, un ou plusieurs hôtes, des IP publiques, le stockage, les sauvegardes et l'exploitation peuvent être payants. La délivrabilité dépend aussi des politiques et de la réputation auprès des fournisseurs destinataires.

## 2. Principes non négociables

1. Pas de daemon SMTP/IMAP persistant sur Vercel. Vercel héberge l'application et ses API ; les MTA résident sur des hôtes Linux dédiés.
2. Pas d'open relay : réception MX publique limitée aux domaines hébergés ; soumission sortante authentifiée et autorisée.
3. Isolation multi-tenant : l'organisation et les droits sont résolus côté serveur depuis l'identité MAGNISA, jamais depuis des identifiants tenant fournis par le client ou un MTA distant.
4. Pas de secrets dans Git, le navigateur, les variables `NEXT_PUBLIC_*` ou les journaux.
5. Idempotence des opérations d'envoi, d'ingestion et des événements de livraison.
6. `accepted` signifie accepté dans la file locale, pas livré au destinataire. `delivered` doit reposer sur un résultat SMTP distant/DSN fiable.
7. Aucun changement MX, PTR, firewall, exposition de port ou activation du kill switch sans validation explicite de l'opérateur.
8. Les tests locaux (Mailpit) ne sont jamais présentés comme des tests Internet réels.

## 3. Architecture logique

```text
MAGNISA CORE
  ├── identité / authentification
  ├── organisations / rôles / permissions
  └── abonnement / quotas / audit
          |
          v
MAGNIBOX APPLICATION (Next.js / Vercel)
  ├── Domain & Identity API
  ├── Mailbox API
  ├── Message API / recherche / dossiers
  ├── Send API + autorisation + quotas
  └── événements internes signés
          |
          v
MAGNIBOX MAIL CORE (hôtes Linux dédiés)
  ├── SMTP ingress : Postfix TCP/25
  ├── SMTP submission : Postfix TCP/587 + STARTTLS + authentification
  ├── SMTP egress : Postfix queues / retry / DSN
  ├── policy & filtering : Rspamd, SPF, DKIM, DMARC, antivirus/quarantaine
  ├── mailbox access : stockage/API ; IMAP via Dovecot si requis
  ├── DKIM key service : clés privées isolées et rotation
  └── observabilité : métriques, logs expurgés, alertes, audit
          |
          v
INTERNET SMTP (Gmail, Outlook, Yahoo, autres domaines)
```

## 4. Responsabilités par composant

| Composant | Responsabilité | Ne doit pas faire |
|---|---|---|
| MAGNISA Core | identité, tenant, rôles, quotas | accepter une autorisation fournie par le navigateur |
| Domain Engine | preuves DNS, état de vérification, activation | modifier les DNS du client automatiquement |
| Mailbox Engine | boîtes, alias, quotas, état | créer une boîte sans contrôle d'appartenance au domaine |
| Postfix ingress | réception SMTP et file entrante | livrer un message à un tenant non autorisé |
| Filtering | SPF/DKIM/DMARC, réputation, antispam, antivirus | considérer un contenu non analysé comme sûr |
| Storage | MIME brut, corps, pièces jointes, index | exposer des objets privés sans contrôle d'accès |
| Postfix egress | soumission, livraison, retry, DSN | relayer anonymement ou contourner les limites anti-abus |
| Dovecot | compatibilité IMAP et accès boîte si retenu | devenir la source d'autorité des permissions MAGNISA |
| Event bridge | événements signés, horodatés et idempotents | accepter des statuts de livraison non vérifiés |
| Operations | sauvegardes, restauration, supervision, incidents | activer le trafic public avant les gates de recette |

## 5. Flux de réception

1. Un serveur distant résout le MX du domaine destinataire et se connecte au port 25.
2. Postfix vérifie que le domaine est hébergé et que le destinataire est autorisé via une carte synchronisée et versionnée.
3. Le message est placé en file ; les contrôles de protocole et de taille sont appliqués.
4. Rspamd évalue le message (SPF, DKIM, DMARC, réputation, règles anti-spam). Les pièces jointes suivent le pipeline de quarantaine et d'analyse antivirus.
5. Après validation, le bridge transmet le message au endpoint interne MAGNIBOX via HMAC horodaté.
6. L'application résout le destinataire et l'organisation depuis ses propres tables, persiste le message de manière idempotente et publie une notification.
7. Les erreurs temporaires sont réessayées ; les erreurs permanentes produisent une réponse SMTP appropriée ou un événement de rejet selon le stade.

## 6. Flux d'envoi

1. L'utilisateur demande l'envoi via l'API MAGNIBOX.
2. L'API vérifie la session, l'appartenance à l'organisation, la permission, l'identité expéditrice, le domaine vérifié, les quotas et les limites anti-abus.
3. Le message et sa clé d'idempotence sont enregistrés avant la soumission.
4. Le service de transport interne soumet le message au port 587 avec STARTTLS et authentification.
5. Postfix signe DKIM avec la clé du domaine et applique la politique de sortie.
6. La file Postfix effectue la livraison SMTP distante, avec temporisation et retry bornés.
7. Les résultats de livraison/DSN sont rapprochés du queue ID ; les événements sont signés et idempotents.
8. L'interface distingue clairement queued, deferred, delivered, bounced et failed.

## 7. Contrats internes

Les routes applicatives ne doivent pas dépendre directement des détails d'un fournisseur. Elles utilisent une interface de transport interne avec des opérations équivalentes à :

- `submit(message, idempotencyKey) -> { queueId, acceptedAt }`
- `ingest(signedEnvelope) -> { storedMessageIds }`
- `recordDeliveryEvent(signedEvent) -> { applied }`
- `syncRecipients(domainId, version, recipients) -> { acknowledgedVersion }`

Les contrats doivent être versionnés, validés par schéma, bornés en taille et protégés par authentification mutuelle ou HMAC avec secrets distincts par usage. Les retries doivent conserver la même clé d'idempotence.

## 8. Stockage et données

- PostgreSQL/Supabase reste la source d'autorité pour les tenants, domaines, identités, permissions, métadonnées de messages et états.
- Le MIME brut et les pièces jointes sont stockés dans un stockage privé durable, avec chiffrement au repos, contrôle d'accès, empreintes et politique de rétention.
- Les clés DKIM privées restent sur les hôtes de transport ou dans un gestionnaire de secrets adapté ; elles ne sont jamais stockées dans des tables lisibles par le client.
- La quarantaine est distincte du contenu disponible dans la boîte.
- Les migrations doivent être additives, relues et rejouées en CI ; aucun changement direct de base de production dans le cadre de cette RFC.

## 9. Sécurité et anti-abus

- SPF, DKIM et DMARC sont vérifiés en entrée et configurés en sortie.
- TLS est obligatoire pour la soumission authentifiée ; le certificat du MTA doit correspondre au FQDN.
- Les limites couvrent destinataires par message, messages par compte, débit par IP/compte, taille, stockage et nombre de connexions.
- Les comptes compromis, rebonds anormaux, plaintes et pics de volume déclenchent blocage ou suspension contrôlée.
- Le port 25 n'est jamais un relais sortant ouvert ; le port 587 exige une authentification et une autorisation explicites.
- Les journaux excluent les corps, mots de passe, tokens et pièces jointes.
- Les sauvegardes sont chiffrées, externalisées et régulièrement restaurées en exercice.

## 10. Topologie de déploiement

### Phase pilote isolée
- Un hôte Linux dédié, une IP publique stable, un FQDN mail dédié et stockage persistant.
- Ports liés à loopback pendant la préparation.
- Vérification écrite de l'hébergeur sur TCP/25 entrant et sortant.
- A/PTR cohérents, TLS, pare-feu, sauvegardes et monitoring.
- Domaine de test ou sous-domaine isolé ; aucun MX de production déplacé.

### Phase pilote Internet
- Exposition des seuls ports approuvés après revue.
- Tests entrants et sortants depuis plusieurs réseaux et fournisseurs indépendants.
- Contrôle des files, DSN, rebonds, plaintes, réputation et restauration.
- Activation explicite par domaine après validation DNS et consentement de son propriétaire.

### Phase production
- Redondance des MTA/MX dans des zones distinctes, supervision 24/7, rotation des clés, gestion d'incidents, capacité et reprise après sinistre.
- Déploiement progressif par domaine, avec kill switch et rollback documentés.

## 11. Gates de validation

| Gate | Critère de sortie |
|---|---|
| G0 — dépôt | architecture, contrats, propriétaires et menaces documentés |
| G1 — laboratoire | compose validé, services sains, ports loopback, tests Mailpit réussis |
| G2 — intégration | provisioning domaines/destinataires et bridge signé testés |
| G3 — sécurité | anti-open-relay, authentification, TLS, limites, quarantaine et restauration testés |
| G4 — réseau | hôte, IP, PTR, TCP/25, pare-feu et certificats vérifiés indépendamment |
| G5 — Internet | aller-retour réel Gmail/Outlook et autre fournisseur, DSN et réputation contrôlés |
| G6 — production | approbation opérateur, runbooks, alertes, sauvegardes et activation par domaine |

Aucun gate ne peut être déclaré réussi sur la seule base d'une compilation ou d'un test local.

## 12. État initial observé dans le dépôt au 2026-11-18

- Le dépôt contient déjà un scaffold Docker Mailserver/Postfix, Mailpit local, un bridge entrant signé, des routes applicatives d'envoi/réception et un document d'architecture native.
- Le README de l'infrastructure indique explicitement que le scaffold n'est pas déployé et que les ports restent liés à loopback par défaut.
- Le kill switch `MAGNIBOX_EXTERNAL_MAIL_ENABLED` doit rester désactivé jusqu'à la validation de tous les gates nécessaires.
- La présente RFC ne change aucun DNS, MX, PTR, firewall, secret, environnement Vercel, base de production ou service public.

## 13. Prochain lot d'implémentation

1. Inventorier les migrations, tables, routes et workers existants par rapport aux contrats de cette RFC.
2. Vérifier les compose files, images et versions épinglées, healthchecks, volumes et permissions.
3. Écrire les tests de contrat pour provisioning des destinataires, ingestion signée, soumission SMTP et événements DSN.
4. Fermer les écarts de sécurité et d'idempotence.
5. Préparer le runbook d'hôte pilote et le test de restauration.
6. N'exposer aucun port et ne modifier aucun MX avant les gates G0–G4 et une approbation opérateur explicite.
