# Magnisa Orbit — migration technique à partir de MAGNIMAIL et MGMail

**Produit :** Magnisa Orbit — Communication & Productivity  
**Conteneur applicatif :** MAGNISA / Magnisa Box  
**Approche :** migration incrémentale sans suppression des structures historiques.

## Identité de la messagerie

**Magnibox est le nom définitif du produit de messagerie de Magnisa Orbit.**
Il remplace les anciennes appellations MAGNIMAIL, GMMAIL/MGMail et Magnisa Inbox.
Aucun de ces anciens noms ne désigne une autre application à présenter aux utilisateurs.

Le point d'entrée canonique est `/orbit/magnibox`. Les anciennes routes
`/orbit/inbox`, `/magnimail`, `/magnimail/interne` et les API
`/api/magnimail/*` restent compatibles avec les intégrations et les messages
déjà enregistrés. Leurs noms techniques et les tables `mgmail_*` ne sont pas
renommés par ce rebranding.

La messagerie interne et les comptes Internet facultatifs apparaissent dans
le **même espace Magnibox**. Les transports et modèles historiques restent
distincts en interne jusqu'à leur agrégation complète, sans créer un second
produit, sans exiger Gmail et sans prétendre qu'un domaine public est déjà actif.

## 1. Sources et inventaire vérifiés le 14/11/2026

- Le compte GitHub connecté expose `martinot-svg/MAGNISA` et `martinot-svg/ZARAY`. Aucun dépôt indépendant MAGNIMAIL, GMMAIL ou MAGNISA BOX n'a été identifié parmi ses dépôts accessibles. Ne pas inventer de transfert inter-dépôts.
- `MAGNISA` utilise Next.js 15.5.29, React 19, TypeScript, Supabase Auth/PostgreSQL/RLS et Vercel.
- Les routes préexistantes de messagerie `/magnimail` et `/magnimail/interne` et les API `/api/magnimail/*` sont **conservées**.
- MAGNIMAIL externe aujourd'hui sur `main` lit `email_connections` avec `provider='google'` et utilise l'intégration Gmail OAuth. Aucun adaptateur Microsoft Graph ou IMAP/SMTP général n'a été prouvé fonctionnel sur `main`.
- MGMail interne dispose des tables `mgmail_internal_namespaces`, `mgmail_internal_mailboxes`, `mgmail_internal_messages`, `mgmail_internal_mailbox_grants`, `mgmail_internal_message_reads`. Les migrations `20261114103000`, `20261114103100` et `20261114103200` sont inscrites au ledger de production.
- La gestion des vrais domaines Internet (DNS MX/SPF/DKIM/DMARC, émetteur/réception et vérification réelle) n'est **pas livrée** en production. Les branches historiques `feat/mgmail-verified-domains`, `feat/mgmail-internet-resend` sont divergentes de `main` et ne doivent pas être fusionnées en bloc.
- Les travaux d'agenda de `#218` (UI) et `#219` (schéma) sont en PR brouillon : leurs migrations ne sont pas en production. L'interface Orbit doit donc distinguer la vue de dates des projets *existants* de l'agenda collaboratif *à venir*.
- `projects` existe déjà, avec états `planned`, `active`, `on_hold`, `completed`, `cancelled` ; c'est une donnée commerciale et non un modèle complet de tâches.

## 2. Cartographie de compatibilité

| Orbit | Source existante réutilisée | Statut |
| --- | --- | --- |
| `/orbit` | AppShell, session et organisation MAGNISA | Intégration dans la navigation, aucun login en doublon |
| `/orbit/magnibox` (**Magnibox**) | `/magnimail` (réutilise le moteur et les données historiques) | Messagerie interne et comptes Internet connectés dans un même espace |
| `/orbit/inbox` | Alias historique vers le même composant | Compatibilité des signets existants, sans nouveau produit |
| `/magnimail/interne` | Boîtes, messages, RLS et permissions existantes | Route et tables conservées |
| `/orbit/planner` | Échéances `projects.end_date` | Première vue en lecture ; agenda personnel en cours |
| `/orbit/time` | Dates `projects.start_date/end_date` | Première grille mensuelle en lecture |
| `/orbit/action` | Dossiers `projects` existants | Tableau de suivi des projets ; Kanban de tâches à développer |

Le `key='magnimail'` du catalogue fonctionnel est **conservé** : seules sa présentation et son URL de menu changent pour Orbit. Ceci évite une modification de `organization_features` ou des droits utilisateurs. Les anciens signets et API continuent de fonctionner.

## 3. Livraison des fonctionnalités non encore opérationnelles

### Magnibox : identité professionnelle multidomaine
1. Inventorier les services externes disponibles sans partager les secrets ; séparer Gmail OAuth, Microsoft Graph, IMAP/SMTP et transport SMTP/inbound.
2. Reprendre **de façon ciblée** les branches de demandes de domaines et les tests, sans intégrer leurs anciennes migrations et dépendances divergentes.
3. Définir une demande de domaine par organisation, avec preuve DNS **externe au navigateur**, registre des vérifications, expiration et retrait. Ne jamais permettre l'usurpation d'un domaine d'une autre entreprise.
4. Distinguer **domaine vérifié**, **identité expéditrice**, **boîte réelle**, **alias** et **délégation**. Aucun envoi externe sans transport réellement disponible ; aucune réception revendiquée sans MX, webhook/IMAP ou fournisseur effectivement configuré et testé.
5. Utiliser les permissions côté serveur, journaliser les changements, suspendre immédiatement un collaborateur sorti de l'entreprise.
6. Valider SPF, DKIM, DMARC, MX, envoi externe, réception réelle d'une réponse, pièces jointes et limites anti-abus avant la première activation d'une identité publique.

### Planner + Time
- Fusionner et appliquer **d'abord** le lot de schéma #219, après CI, sauvegarde chiffrée restaurée, preflight puis `APPLY` explicite.
- Vérifier les ACL et la routine de rappels ; ensuite seulement intégrer l'interface #218 dans les deux routes Orbit (pas de migration en double).
- Protéger les rendez-vous privés, les agendas de services et les événements d'entreprise ; conserver les préférences de notification.

### Action
- Introduire des tâches et sous-tâches **distinctes** des projets commerciaux, reliées en option à `projects.id`.
- Vérifier les assignations à des membres actifs de l'organisation avec RLS, audit des changements, statut, échéance et responsable.
- Ajouter commentaires/attachments après vérification des politiques Storage et antivirus ; les projets financiers historiques ne doivent pas être transformés en tâches.

## 4. Garde-fous de migration et déploiement

- Pas de `DROP`, `TRUNCATE`, `supabase db reset` sur la vraie base, ni de renommage des tables `mgmail_*` ou des colonnes `email_connections`.
- Les tests sur base **jetable** peuvent utiliser `supabase db reset` ; ce n'est pas la production.
- Chaque migration passe par SQL versionné, revue du RLS, replay sur base isolée, sauvegarde chiffrée avec restauration testée, preflight et `APPLY` explicite. Toujours vérifier l'historique après application.
- Aucune dépendance Gmail imposée, aucun domaine ou hébergement gratuit promis ; pas d'activation de transport externe sans secret fournisseur protégé côté serveur.
- Suivi GitHub : issue #192 (multi-fournisseurs), #217 (MGMail interne livré), #218 et #219 (agenda), plus les nouveaux lots Orbit.
- Le statut `READY` Vercel confirme la publication du code mais **pas** un essai authentifié entre deux collaborateurs en production, ni la délivrabilité externe.

## 5. Critères de recette

- Vérifier le build, Vitest, les routes `/orbit/*`, la navigation mobile et l'accès par organisation.
- Rejouer les échanges MGMail entre deux comptes de test sans perte de message et sans fuite inter-entreprises.
- Pour les domaines : prouver la propriété DNS, les autorisations par collaborateur et l'aller-retour d'un e-mail vers une adresse Internet réelle.
- Pour les agendas : vérifier les dates, les fuseaux horaires, la confidentialité et l'absence de rappels en double.
- Pour Action : vérifier tâches, sous-tâches, assignations, changements de statut et rejet des accès directs non autorisés.

## 6. État du premier lot

L'introduction de la navigation Orbit, la messagerie Magnibox et les vues de projets existants ne requièrent **aucune migration Supabase** et sont réversibles par code. Le calendrier collaboratif complet, les boîtes publiques multidomaines et le vrai Kanban de tâches seront suivis comme **lots distincts**, pas présentés comme livrés prématurément.
