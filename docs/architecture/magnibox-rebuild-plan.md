# MAGNIBOX — architecture cible et plan de reconstruction

## Décision

MAGNIBOX est l'unique produit de messagerie de MAGNISA. Les anciennes routes et tables peuvent rester des adaptateurs de compatibilité pendant la migration, mais elles ne définissent plus l'architecture cible.

La reconstruction est additive et progressive : aucune table historique, migration déjà appliquée, route CRM ou donnée utilisateur ne doit être supprimée sans preuve d'absence de dépendance et plan de migration réversible.

## Principes non négociables

1. Aucun fournisseur externe obligatoire pour les utilisateurs MAGNISA.
2. Resend, Gmail et Microsoft sont des connecteurs facultatifs, jamais le cœur du produit.
3. Le catalogue IANA/NIC.MG existant reste la source de référence des extensions. Il n'est ni réécrit ni assimilé à un service d'enregistrement.
4. Un domaine interne MAGNISA n'est jamais présenté comme une adresse publique joignable depuis Internet.
5. Une adresse publique ne devient active qu'après contrôle de propriété du domaine, configuration DNS et activation d'un transport réellement opérationnel.
6. Les messages, pièces jointes, journaux et identités sont isolés par organisation.
7. Toute action sensible est autorisée côté serveur et protégée par RLS lorsque la base est exposée.
8. Aucun statut « livré » ou « ouvert » n'est inventé : les états reflètent uniquement les preuves fournies par le transport ou un mécanisme de suivi explicitement activé.

## Architecture fonctionnelle

### 1. MAGNIBOX Core
- Contexte d'organisation et identité de l'utilisateur authentifié.
- Autorisations par boîte et par action (lecture, envoi, administration).
- API interne stable utilisée par les interfaces et les modules MAGNISA.
- Journal d'audit des opérations sensibles.

### 2. MAGNIBOX Domain
- Réutilise le catalogue existant `magnibox_tld_catalog` et le moteur IANA/NIC.MG.
- Sépare catalogue d'extensions, demandes de domaines, domaines vérifiés et domaines activés.
- Gère les domaines internes MAGNISA séparément des domaines publics.
- Vérifie les domaines publics par challenge DNS et contrôle périodique.
- Ne prétend pas enregistrer ou attribuer un domaine public sans registrar/registre autorisé.

### 3. MAGNIBOX Mailboxes
- Boîtes personnelles et boîtes de service partagées.
- Délégations nominatives, permissions lecture/envoi séparées.
- Suspension automatique des accès lors du départ ou de la suspension d'un collaborateur.
- Conservation des historiques existants et migration contrôlée des données internes historiques.

### 4. MAGNIBOX Message Store
- Messages entrants, sortants et brouillons.
- Fils de conversation, destinataires, copies, pièces jointes et métadonnées.
- Stockage des pièces jointes privé, avec contrôle d'accès à chaque téléchargement.
- Clés d'idempotence pour éviter les doubles envois.
- Rétention, archivage et suppression encadrés par politique.

### 5. MAGNIBOX Transport
- Interface de transport indépendante du fournisseur.
- Connecteurs facultatifs (Resend, SMTP tiers, Microsoft Graph, autres).
- Cible autonome : MTA/SMTP sortant, réception SMTP entrante, files persistantes, traitement des rebonds et supervision.
- Le transport Internet reste désactivé tant que DNS, réputation, anti-abus, capacité opérationnelle et tests de réception/envoi ne sont pas validés.
- La réception entrante doit authentifier la destination, dédupliquer les événements et empêcher toute association à une boîte sans identité active correspondante.

### 6. MAGNIBOX Security & Deliverability
- SPF, DKIM et DMARC pour les domaines publics.
- TLS en transit et chiffrement des secrets.
- Contrôles anti-usurpation, anti-spam, quotas et limitation de débit.
- Analyse des fichiers et limites de taille/type.
- Journalisation sans exposer le contenu privé des messages.
- Secrets exclusivement côté serveur ; aucun secret dans les variables publiques.

### 7. MAGNIBOX Tracking
- États distincts : brouillon, en file, tentative d'envoi, accepté par le relais, distribué (si confirmé), rebondi, échec, état inconnu.
- « Ouvert » n'est affiché que si un signal de suivi existe, avec avertissement sur sa fiabilité.
- Les webhooks sont signés, horodatés, dédupliqués et validés avant toute écriture privilégiée.

## Plan d'exécution

### Étape A — Inventaire et contrats
- Cartographier toutes les routes, composants, actions serveur, tables, politiques RLS, fonctions SQL, tâches cron et intégrations.
- Identifier les consommateurs externes des routes historiques (factures, devis, notifications, CRM).
- Établir des tests de contrat et une matrice des permissions.
- Conserver le catalogue d'extensions existant.

### Étape B — Socle Core
- Introduire des contrats/types communs pour identités, boîtes, messages et transports.
- Centraliser l'autorisation et l'isolation par organisation.
- Ajouter des tests unitaires et d'intégration avant de rediriger les routes.

### Étape C — Boîtes et stockage
- Unifier progressivement les boîtes internes et publiques dans l'interface, sans mélanger leurs règles de transport.
- Préserver les tables historiques par adaptateurs.
- Migrer les données avec identifiants stables, vérification des comptes et procédure de retour arrière.

### Étape D — Domaines
- Construire les demandes, vérifications, affectations et états opérationnels autour du catalogue actuel.
- Ne jamais assimiler présence dans le catalogue et disponibilité/enregistrement.

### Étape E — Transport
- Formaliser une interface fournisseur et rendre les connecteurs interchangeables.
- Développer le transport autonome dans un environnement isolé.
- Activer l'envoi puis la réception publique uniquement après tests d'interopérabilité, sécurité et délivrabilité.

### Étape F — Suivi et exploitation
- Traiter les événements de transport de manière idempotente.
- Ajouter métriques, alertes, limites d'envoi et procédures d'incident.
- Tester les échanges entre deux organisations, deux domaines publics et des fournisseurs externes.

## Critères d'acceptation avant production

- Les utilisateurs n'ont pas besoin d'un compte Gmail ou Outlook.
- Une panne d'un fournisseur facultatif ne bloque pas la messagerie interne.
- Aucun utilisateur ne peut lire ou envoyer depuis une boîte sans permission explicite.
- Les tests démontrent l'isolation inter-organisations.
- Les pièces jointes ne sont accessibles qu'aux destinataires autorisés.
- Les migrations sont rejouables sur une base vierge et ne détruisent aucune donnée historique.
- L'envoi et la réception Internet sont validés depuis/vers des domaines externes réels.
- Les statuts affichés sont fondés sur des événements vérifiés.
- Les tests CI, migrations, RLS et contrôles de sécurité passent.

## État

Ce document décrit la cible et l'ordre d'exécution. Il ne signifie pas que le moteur SMTP/IMAP autonome, l'enregistrement de domaines ou la réception Internet sont déjà implémentés ou opérationnels.


## Journal de reconstruction — 14 novembre 2026

### Socle Core ajouté sur la branche de travail

- `src/lib/orbit/core.ts` introduit un vocabulaire commun et indépendant du fournisseur pour les boîtes, les actions et les états de distribution.
- `src/lib/orbit/core.test.ts` couvre les droits explicites, l'appartenance active, l'isolation entre organisations et la distinction entre acceptation par un fournisseur et livraison confirmée.
- Ces fonctions sont des contrats de domaine : elles ne remplacent ni l'authentification serveur, ni les contrôles RLS, ni la vérification des droits en base.

### Dépendances de schéma vérifiées

La migration de demandes de domaines existe bien sous le nom exact `20261114120000_orbit_public_domain_requests.sql`. Elle précède `20261114122000_orbit_internet_identities.sql` et crée les deux tables de demandes attendues. Le nom de fichier précédemment recherché était incorrect ; aucune migration de remplacement n'est nécessaire à ce stade.

### Limites restantes

- Les contrats Core sont ajoutés mais ne sont pas encore branchés aux routes et composants historiques.
- Le transport Internet existant reste lié à Resend dans sa route d'envoi ; il ne constitue pas encore une architecture multi-fournisseur opérationnelle.
- Aucun moteur SMTP autonome, aucune réception SMTP directe et aucune migration de données historiques n'ont été réalisés dans cette étape.
- Les tests Vitest et le replay Supabase doivent être exécutés par la CI de la branche avant toute fusion. Aucun déploiement ni activation du transport n'est autorisé par ces commits.
