# Magnibox — routes du transport Internet natif (SMTP MAGNIBOX)

## Architecture actuelle
L'envoi Internet passe exclusivement par le transport SMTP natif MAGNIBOX.
Le transport est désactivé par défaut et ne doit être activé qu'après
configuration serveur, vérification DNS et recette opérationnelle.

- Le serveur choisit l'identité expéditrice depuis l'organisation authentifiée.
- Les droits individuels et les validations de domaine/adresse sont contrôlés
  avant toute opération privilégiée.
- Les demandes sont enregistrées dans le ledger avec une clé UUID anti-doublon.
- La réservation du quota et la création du message sont effectuées par la
  fonction SQL transactionnelle `orbit_reserve_magnibox_outbound`.
- Les pièces jointes ne peuvent provenir que de messages entrants de la même
  boîte et de fichiers dont l'analyse antivirus a abouti au statut disponible.
- Les erreurs de transport ambiguës restent en état `uncertain` ; aucun renvoi
  automatique ne doit risquer de dupliquer un message.

## Activation
Le kill switch serveur `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true` est requis,
ainsi qu'une configuration SMTP MAGNIBOX valide. Les secrets restent côté
serveur. Aucun secret n'est fourni par le navigateur ni codé en dur.

## Réception et événements
La route historique `/api/magnibox/internet/webhook` est volontairement
retirée (HTTP 410). La réception publique doit passer par le MTA MAGNIBOX,
puis par le pont privé signé `/api/internal/magnibox/inbound`.
Les accusés SMTP sont traités par la passerelle native des événements de
livraison. Aucun webhook Resend/Svix n'est utilisé dans cette architecture.

## Contrôles préalables à la mise en production
- Migrations Supabase appliquées et vérifiées.
- Domaine détenu par l'organisation, enregistrements MX/SPF/DKIM/DMARC validés.
- Serveur SMTP dédié accessible, IP publique et reverse DNS cohérent.
- Antivirus opérationnel pour les pièces jointes.
- Recette réelle d'envoi, réception, livraison, rebond et échec.
- Surveillance des quotas, files SMTP et erreurs.

La fusion du code applicatif ne constitue pas une preuve de transport Internet
opérationnel. Ne jamais annoncer une livraison réelle sans preuve de bout en bout.
