# Magnisa Orbit / Inbox — domaines publics et adresses professionnelles

## Fonctionnement implémenté dans ce lot

Cette évolution concerne les **demandes de domaines et d'adresses** et ne simule jamais l'envoi ou la réception de courriels Internet.

- Un administrateur MAGNISA ayant `users.manage` peut demander plusieurs domaines qui lui appartiennent ou sont légalement mis à disposition : `entreprise.mg`, `entreprise.com`, `entreprise.org`, etc.
- Il peut demander une adresse professionnelle (ex. `finance@entreprise.mg`) rattachée à une boîte MGMail interne autorisée ; les permissions existantes de cette boîte ne sont pas dupliquées.
- La demande est enregistrée avec `status=pending` ; aucun salarié ou administrateur d'entreprise ne peut modifier le statut en vérifié / approuvé.
- L'adresse est générée côté PostgreSQL depuis le domaine et la partie locale, empêchant un client API d'écrire une adresse qui ne correspond pas au domaine demandé.
- Les clés étrangères composites, RLS et permissions SQL empêchent les références interentreprises. Un index unique empêche qu'un même domaine soit marqué `verified` pour deux entreprises, sans permettre à des demandes non vérifiées de bloquer le domaine d'autrui.
- Les anciennes tables `mgmail_internal_*`, `email_connections`, les messages et l'authentification restent intacts.

## Ne pas confondre

| Élément | Effet |
| --- | --- |
| Demande de domaine | Enregistrement administratif, **aucun DNS créé** |
| Domaine syntaxiquement valide | **Aucune preuve de propriété** ni de délivrabilité |
| Demande d'adresse | Souhait de création, **pas une véritable boîte externe** |
| Adresse Internet active | Nécessite propriété et DNS validés, fournisseur/transport configuré et testé |
| Boîte partagée | Ressource unique avec droits par collaborateur |
| Alias | Identité routée vers une boîte ; à différencier d'une deuxième boîte réelle |

## Suite impérative avant activation d'un domaine

1. Vérifier que l'entreprise contrôle le domaine et les DNS. Documenter l'identité vérificatrice, la preuve et sa durée de validité.
2. Tester MX entrant, SPF, DKIM et DMARC selon le fournisseur réellement choisi, sans remplacer les DNS existants sans consentement.
3. Conserver un **registre privilégié** des capacités d'envoi/réception, distinct des demandes ; ne jamais laisser un navigateur l'alimenter.
4. Provisionner une identité active seulement si la preuve du même domaine et de la même entreprise est valide, avec un transport prenant en charge le domaine.
5. Établir la distinction entre boîte propre et alias, puis attribuer / révoquer les droits lecture, envoi, réponse, gestion et délégation à des collaborateurs actifs. Journaliser les opérations.
6. Envoyer vers une boîte externe réelle, recevoir sa réponse et vérifier la signature, la délivrabilité, les échecs et la protection anti-abus avant la qualification de production.

## Livraison

Le lot touche `20261114120000_orbit_public_domain_requests.sql`, les validations et l'interface administrative `/magnimail/domaines` (sous Magnisa Inbox). Comme il comporte une nouvelle migration, son interface **ne doit pas être activée en production** avant :
- replay Supabase intégral et tests d'accès refusés sur base isolée ;
- sauvegarde chiffrée restaurable du commit de schéma exact, préflight et `APPLY` contrôlé ;
- vérification du ledger et des autorisations réelles dans Supabase ;
- fusion de l'interface après la disponibilité effective des tables.

Un test de recette **local** prouve l'isolement, mais **aucun** test local ne prouve l'envoi ou la réception Internet. Aucune dépense externe n'est imposée.
