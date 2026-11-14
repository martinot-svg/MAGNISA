# MGMail — Livraison préalable du schéma interne

Cette branche prépare la base des **boîtes collaborateur**, sans exposer les écrans de la PR #198 avant activation du schéma.

## Migrations (SQL conservé à l'identique)

Leur numérotation est avancée pour rester **après** la dernière migration de production `20261113184000`.

| Ancienne branche empilée | Version à livrer | Fonction |
|---|---|---|
| `20261113150000_mgmail_internal_mail.sql` | `20261114103000_mgmail_internal_mail.sql` | Identités internes, boîtes, messages et RLS |
| `20261113163000_mgmail_internal_notifications.sql` | `20261114103100_mgmail_internal_notifications.sql` | Notifications et lecture |
| `20261113180000_mgmail_shared_mailboxes.sql` | `20261114103200_mgmail_shared_mailboxes.sql` | Permissions individuelles et boîtes partagées |

**Aucune des versions 20261113 ci-dessus ne doit être appliquée à la production** ; elles restent préservées dans `backup/mgmail-stacked-original-20261114` et les anciennes branches de la pile.

## Conditions de sécurité

- Aucune connexion Gmail requise ; `*.mgmail` est un identifiant interne non routable sur Internet.
- Boîtes limitées à une organisation, attribution à des membres actifs.
- Vérification de lecture/envoi par identité authentifiée, RLS et refus d'usurpation.
- Révocation de l'accès au départ ou à la suspension d'un collaborateur.
- Boîtes de service déléguées par un administrateur, droits `can_read` et `can_send` indépendants.
- Aucun ajout de fournisseur Internet ni de domaines publics dans cette livraison.
- Tests automatisés : `scripts/ci/mgmail-internal-mail-integration.mjs`, deux utilisateurs authentifiés, notification, lecture, révocation et isolation.

## Séquence de livraison

1. CI + rejeu complet Supabase réussi sur cette branche.
2. Revue SQL/RLS, puis fusion de cette seule PR de schéma.
3. Sauvegarde **chiffrée restaurée et vérifiée** pour le SHA exact de la version de `main`.
4. Préflight de production positif : trois versions autorisées et aucune divergence.
5. Application contrôlée **`APPLY`** des trois migrations, dans cet ordre, puis vérification de la présence des objets et politiques par une connexion en lecture seule.
6. Réconciliation de la PR #198 sur `main`, **sans écraser les correctifs récents de MAGNISA**. Restaurer uniquement le module MGMail interne dans la PR #198 ; préserver les autres travaux sur la branche de sauvegarde.
7. CI et recette réelle avec deux collaborateurs d'essai, puis fusion de #198 et contrôle Vercel et de la sécurité.

Le dépôt ne doit pas être considéré « MGMail opérationnel en production » sur la seule base d'un replay de CI.
