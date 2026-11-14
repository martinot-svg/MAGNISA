# Magnibox — routes du transport Internet (optionnelles et inactives par défaut)

## Objectif
Rendre possible, ultérieurement, l'envoi et la réception de vrais courriers
Internet pour chaque organisation de MAGNISA, sans second produit, sans
compte Gmail imposé et sans partage des identifiants entre collaborateurs.

Cette étape ajoute uniquement des **routes serveur protégées** utilisant
les tables de la migration `20261114122000` et le transport facultatif
de Resend. L'envoi n'est **pas actif** en production au moment de l'ajout
de ces fichiers.

## Activation contrôlée, jamais depuis le navigateur
- `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true` : kill switch côté serveur.
- `RESEND_API_KEY` : clé privée serveur, **jamais** `NEXT_PUBLIC_*`.
- `RESEND_WEBHOOK_SIGNING_SECRET` : secret distinct du webhook.
- `MAGNIBOX_OUTBOUND_DAILY_LIMIT` : plafond conservateur par adresse,
  10 messages/24h par défaut, maximum 20 (protection initiale).
- Ne pas configurer ces secrets/flags avant d'avoir appliqué la migration,
  activé le domaine avec le fournisseur, puis procédé à une recette réelle.
  La limite SQL atomique globale, la lutte antispam et le débit fournisseur
  devront être renforcés avant tout volume élevé.

## Route sortante
`POST /api/magnibox/internet/send`

JSON : `{ identityId, requestId, to, subject, text }`.

Le champ `from` et l'organisation fournis par le client **ne sont jamais
acceptés** : ils proviennent exclusivement de l'identité activée et de
l'organisation authentifiée. Avant tout envoi, le serveur vérifie :

1. l'appartenance active à l'organisation sélectionnée ;
2. l'identité visible sous RLS et autorisée via
   `orbit_can_public_mail_access(..., 'send')` ;
3. le domaine `verified`, l'adresse `approved`, l'identité `active`,
   le fournisseur enregistré et les secrets de transport ;
4. les destinataires et les bornes de taille, le quota préliminaire ;
5. l'enregistrement en base avant l'appel réseau, avec une clé
   `requestId` **unique** pour éviter les doubles envois.

En cas de défaillance après l'appel fournisseur, la réponse signale
`uncertain` ; aucune relance automatique hasardeuse. `accepted` signifie
**accepté par le fournisseur**, pas `delivered`.

## Route de réception et événements
`POST /api/magnibox/internet/webhook`

1. Contrôle **du corps brut** avec signature Svix/Resend et horodatage court.
2. Sur `email.received`, récupère le contenu réel avec l'API fournisseur
   authentifiée ; ne prend pas le corps du message envoyé par le webhook.
3. Détermine les destinataires par **adresse exacte**, dans les seules
   identités `active`, `receive_enabled`, fournisseur `resend`, avec
   domaine toujours `verified` et adresse `approved`.
4. Insère une entrée `incoming` dans le ledger de chaque organisation
   réellement destinataire, avec déduplication par identifiant fournisseur.
5. Sur événement `email.delivered`, `bounced` ou `failed`, met à jour
   le statut de l'envoi concerné, sans accès aux messages d'une autre entreprise.

Ne jamais considérer un 200 webhook comme la preuve que tous les clients ont
reçu le courrier. Les envois et réponses doivent être testés avec une vraie
adresse extérieure sur des domaines possédés par les organisations.

## Non disponible / reste à développer
- Provisionnement privilégié des identités après preuve DNS et vérification
  du domaine fournisseur, avec audit et réinspection DNS périodique.
- Interface utilisateur unique de composition et lecture Internet utilisant
  ces routes, pièces jointes, brouillons et dossiers combinés.
- Quotas SQL atomiques par organisation, surveillance anti-abus, antivirus,
  archivage et conformité, analyse des événements d'échec et de rebond,
  capacité d'autres fournisseurs (SMTP/IMAP, Microsoft Graph) ;
  la prise en charge d'un fournisseur n'est pas universelle.
- Ajout du domaine chez le fournisseur, MX/SPF/DKIM/DMARC et webhook actif
  sur une URL publique réellement accessible, avec secrets côté serveur.
- **Aucun paiement ni abonnement** réalisé par ce code ; la gratuité
  effective dépend des limites et conditions du fournisseur et de la
  possession du domaine.

## Compatibilité
Le dossier et les tables historiques `mgmail_*`, les routes
`/magnimail`, `/orbit/inbox` et l'intégration OAuth Gmail sont inchangés.
Seule **Magnibox** est affichée comme messagerie dans MAGNISA.
