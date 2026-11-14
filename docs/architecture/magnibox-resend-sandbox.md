# Magnibox — réception Resend de test sans domaine acheté

La réception de messages sur `<alias>@tolokroneu.resend.app` est **un diagnostic de connectivité**, pas la création d'une vraie boîte professionnelle. L'application ne doit jamais associer un alias d'essai à une entreprise, à un collaborateur ou à une identité `orbit_public_identities` sans preuve de propriété du domaine.

## Préconditions
- Routes Magnibox publiées sur Vercel, `RESEND_API_KEY` et `RESEND_WEBHOOK_SIGNING_SECRET` configurées côté serveur.
- `MAGNIBOX_EXTERNAL_MAIL_ENABLED=false` (envoi réel et réception multi-entreprises désactivés).
- Pour tester **explicitement**, définir en production les variables serveur `MAGNIBOX_RESEND_SANDBOX_ENABLED=true` et `MAGNIBOX_RESEND_SANDBOX_DOMAIN=tolokroneu.resend.app`, puis redéployer.
- Webhook `email.received` du fournisseur : `https://magnisa.vercel.app/api/magnibox/internet/webhook` seulement si cette URL est vraiment rattachée au projet en production.
- Envoyer un **message sans données personnelles ou commerciales** vers `contact@tolokroneu.resend.app`; vérifier le résultat Resend et la réponse webhook.

## Garanties
- La signature Svix est validée sur le corps brut **avant** tout traitement.
- Seuls les messages entrants du domaine de test expressément configuré sont acceptés.
- Le corps est récupéré par l'API Resend avec la clé serveur pour confirmer l'acheminement, mais **ni le contenu ni les métadonnées ne sont écrits dans Supabase**.
- Réponse de diagnostic `{ "ok":true, "mode":"sandbox", "stored":false }` (200). Cela ne confirme **aucune** arrivée en boîte Magnibox, aucune livraison externe sortante et aucune identité publique.
- Un mauvais secret, un fournisseur indisponible ou un destinataire différent donne un statut d'erreur.
- Aucun prérequis supplémentaire de migration de base : isolé du courrier public, inactif par défaut.
- Après diagnostic, remettre `MAGNIBOX_RESEND_SANDBOX_ENABLED=false` et redéployer. Ne jamais utiliser le domaine de test comme domaine contrôlé d'un tenant.

## Mise en production réelle
Exécuter le workflow Supabase protégé (backup chiffré, restauration, préflight, APPLY), vérifier les migrations 20261114120000/122000, vérifier le domaine et l'adresse professionnelle dans Resend et les DNS puis seulement activer `MAGNIBOX_EXTERNAL_MAIL_ENABLED=true` et désactiver le sandbox. Tests de véritable envoi/réception requis.
