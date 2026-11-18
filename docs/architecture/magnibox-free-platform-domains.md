# MAGNIBOX — domaines professionnels gratuits fournis par MAGNISA

## Objectif produit

Toute entreprise créée sur MAGNISA peut sélectionner gratuitement un domaine parmi les domaines complets contrôlés et publiés par MAGNISA, puis obtenir un sous-domaine dédié. Aucun achat individuel de domaine n'est demandé à l'entreprise.

Le parcours canonique est MAGNISA → entreprise → MAGNISA ORBIT → MAGNIBOX → domaines gratuits.

## Séparation des catalogues

- `magnibox_tld_catalog` est le catalogue informatif des extensions et zones (.mg, .com, .digital, etc.). Il ne prouve ni propriété, ni disponibilité, ni configuration mail.
- `magnibox_platform_domain_catalog` est le catalogue opérationnel des domaines racines complets administrés par MAGNISA. Une entrée n'est sélectionnable que si la propriété est vérifiée, MX/SPF/DKIM/DMARC sont validés et l'entrée est activée par un opérateur.
- Les domaines personnalisés appartenant à une entreprise restent dans leur parcours distinct de preuve DNS.

Aucun domaine réel n'est préchargé par cette migration. Les domaines ne peuvent être ajoutés ou rendus sélectionnables que par le service privilégié après contrôle des justificatifs et des DNS. Aucun domaine fictif n'est présenté aux entreprises.

## Attribution gratuite

L'entreprise choisit une racine disponible et un identifiant public. La réservation produit `<identifiant>.<racine>`, avec unicité globale du domaine attribué et une seule réservation courante par entreprise. L'opération est transactionnelle et idempotente pour une même sélection.

Les utilisateurs authentifiés peuvent lire les options sélectionnables et les réservations de leur entreprise. Ils ne peuvent ni créer/éditer le catalogue, ni écrire directement les allocations, ni activer un domaine. La RPC `magnibox_reserve_free_domain` contrôle `users.manage` côté PostgreSQL.

## Limite explicite du premier lot

Une réservation au statut `reserved` n'est pas une boîte e-mail. Elle ne prouve pas encore le provisionnement du sous-domaine, du routage Postfix, d'une boîte, ni l'envoi ou la réception Internet.

Le lot suivant doit relier l'allocation à un objet de boîte MAGNIBOX natif, à la génération de l'adresse, au provisionnement DNS/MTA et aux tests de bout en bout. L'état `active` est protégé par une preuve DNS et une référence de provisionnement ; aucune réservation navigateur ne peut le déclencher.

## Mise en production

1. Exécuter le replay complet PostgreSQL 17 et les tests de contrat/intégration.
2. Ajouter un domaine réel au catalogue uniquement après preuve de contrôle par MAGNISA.
3. Valider MX, SPF, DKIM et DMARC, puis activer l'entrée par service privilégié.
4. Réserver sur un environnement pilote, sans changer les MX de production.
5. Ne pas annoncer la messagerie externe opérationnelle avant un aller-retour réel vers une boîte indépendante.
