# Magnisa Inbox — transport Internet (étape préparatoire)

## Portée du lot

Cet ensemble introduit une **interface de transport Internet** indépendante du fournisseur, avec un premier adaptateur optionnel Resend repris du travail historique `feat/mgmail-internet-resend` et ajusté à Magnisa Orbit.

Le code **n'est raccordé ni à un nouveau bouton d'envoi ni à un webhook public**. Il ne peut donc ni exposer un expéditeur non vérifié ni enregistrer un message dans une mauvaise entreprise. Les routes MGMail internes restent inchangées.

**Vérifications implémentées** :
- Validation d'adresses e-mail Internet et exclusion du suffixe privé `.mgmail`.
- Destinataires limités et sans doublons ; champs de message bornés.
- Envoi via une API externe uniquement sur appel explicite d'un service serveur disposant de l'identité autorisée et des secrets nécessaires.
- Clé d'idempotence stable pour chaque tentative, interdiction des réémissions aveugles après erreur de délai.
- Réponse `accepted` distincte de `delivered`, `failed`, `bounced` et `uncertain`.
- Signature HMAC du fournisseur avant de traiter un événement. Le corps d'un message reçu sera recherché par API authentifiée et non lu depuis les données non fiables d'un webhook.
- Un domaine « enregistré » ou « vérifié par TXT » ne constitue jamais une autorisation d'envoi.

## Conditions non négociables avant activation réelle

1. Terminer et appliquer la migration `20261114120000` (domaines et demandes), depuis le workflow de production contrôlé.
2. Finaliser une migration additive distincte qui enregistre les **identités Internet actives**, les **messages externes** et leur statut, liées à l'organisation et à la boîte historique (sans supprimer `mgmail_internal_*`).
3. Contrôler côté serveur l'autorisation individuelle *read/send*, l'état de la boîte, le personnel actif, et le rattachement du domaine vérifié. L'administrateur ne peut pas s'auto-déclarer propriétaire d'un domaine via le navigateur.
4. Vérifier le DNS de l'expéditeur auprès du fournisseur utilisé : propriété, SPF et DKIM ; examiner MX/DMARC pour la réception et la lutte contre l'usurpation.
5. Configurer le transport choisi : API ou SMTP avec secret **serveur uniquement**. Les clés actuelles Vercel ne contiennent pas de transport Internet MGMail activé.
6. Activer une boîte Internet par un processus privilégié et audité après avoir validé le droit d'émettre et celui de recevoir.
7. Vérifier l'envoi vers une adresse réelle extérieure, l'acceptation, la réception chez le destinataire, puis sa réponse reçue dans Magnisa Inbox. Ajouter la gestion de bounce, de retry prudent et d'anti-spam.
8. Prouver les refus cross-tenant, les révocations immédiates et le non-partage de mots de passe entre collaborateurs.

L'échange entre deux boîtes internes `.mgmail` a ses propres tests, et doit rester fonctionnel indépendamment de toute intégration fournisseur.

## Capacités et limites

**Réalisé dans ce lot :** code d'adaptateur unitaire, transport à API externe facultative, validation de données, HMAC et tests simulant les réponses HTTP.

**Non réalisé dans ce lot :** domaine réel vérifié, credentials de transport configurés, serveur recevant le courrier Internet, stockage des messages externes en production, activation des adresses publiques, vérification de délivrabilité. Les résultats des tests simulés ne constituent **pas** des échanges Internet réels.

**Coûts :** utiliser des services existants ou des forfaits gratuits uniquement lorsque leurs limites le permettent ; aucun abonnement ou achat n'est effectué par la migration. La possession d'un nom de domaine et la délivrabilité peuvent nécessiter une intervention DNS ou un prestataire externe.

## Traçabilité

Source : `martinot-svg/MAGNISA`, issue `#192`. L'ancienne branche expérimentale `feat/mgmail-internet-resend` reste une référence de code, pas une preuve de production. Le nouveau code reste isolé dans `src/lib/orbit/transport/*`, afin de conserver l'ancienne intégration Gmail et le traitement interne MGMail.
