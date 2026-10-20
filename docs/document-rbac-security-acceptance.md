# MAGNISA - Sécurité documentaire : matrice et critères de recette (préproduction)

## Audit du socle
- Supabase Auth vérifie l'utilisateur et le compte actif ; `requireOrganization` sélectionne une adhésion active (actuellement première organisation).
- Rôles conservés : owner, admin, director, finance_manager, accountant, sales, cashier, hr, auditor, employee, viewer.
- Le moteur `src/lib/permissions.ts` résout les valeurs par défaut et les substitutions `role_permissions`, mais `owner` contourne ses restrictions. Aucune dérogation individuelle n'est actuellement résolue.
- Les écrans de modèles et l'identité utilisent respectivement un contrôle owner/admin et settings.manage. Ce n'est pas une protection granulaire.
- `document_templates` ne possède pas encore de propriétaire, de statut de cycle de vie ni de révisions indépendantes.
- Les URL PDF métier exigent une adhésion, mais chaque export doit faire vérifier explicitement le droit métier et `documents.export`.
- Les règles RLS, les journaux et les fichiers privés doivent être testés sous comptes séparés, pas seulement inspectés.
- Aucune modification des comptes, des documents ou des taux de paie ne doit faire partie de cette livraison.

## Permissions à implémenter et à vérifier côté serveur
`templates.view`, `templates.create`, `templates.edit_own`, `templates.edit_shared`, `templates.publish`, `templates.archive`, `templates.delete`, `templates.set_default`, `branding.view`, `branding.edit`, `branding.logo_manage`, `documents.preview`, `documents.generate`, `documents.export`, `documents.print`, `documents.history.view`, `permissions.manage`.

## Règles d'affectation (base, jamais suffisantes sans périmètre métier)
Abréviations : V=view template, C=create, EO=edit_own, ES=edit_shared, P=publish, A=archive, D=delete, S=set_default, BV=branding.view, BE=branding.edit, LM=branding.logo_manage, PR=documents.preview, G=documents.generate, EX=documents.export, I=documents.print, H=documents.history.view, PM=permissions.manage.

| Profil documentaire cible | Base autorisée | Portée / garde additionnelle |
| --- | --- | --- |
| Superadministrateur plateforme | Gestion des modèles généraux uniquement | Aucun accès aux contenus privés des entreprises par défaut ; privilèges de plateforme séparés des droits entreprise |
| Administrateur entreprise (owner/admin) | V,C,EO,ES,P,A,D,S,BV,BE,LM,PR,G,EX,I,H,PM | Même entreprise, aucun droit de paiement ou de validation métier implicite |
| Responsable financier (finance_manager/accountant selon mission) | V,C,EO,BV,PR,G,EX,I,H | Documents financiers uniquement ; paie refusée sans droit métier distinct |
| Responsable RH (hr) | V,C,EO,BV,PR,G,EX,I,H | Documents RH/paie uniquement ; modification des calculs interdite |
| Collaborateur opérationnel (sales/cashier/employee, selon mission) | V,BV,PR,G | Documents relevant des permissions métier ; pas de publication par défaut |
| Auditeur / lecteur (auditor/viewer) | V,BV,H | Consultation conditionnée au droit métier ; export et impression refusés sauf délégation explicite |

Les rôles director et autres historiques ne sont pas automatiquement requalifiés : toute migration conserve leur identité et définit une correspondance révisée et testée. Les exceptions par utilisateur ne peuvent attribuer plus de droits que l'administrateur qui les accorde ; toute interdiction explicite prévaut. La propriété du template et le statut s'ajoutent au contrôle des droits.

## Cycle de vie
Brouillon -> en révision -> publié -> archivé. Modifications d'un modèle publié : nouvelle version, pas remplacement. Approbation obligatoire sur configuration d'entreprise. Suppression logique des versions exploitées dans un historique. Toute restauration crée une nouvelle version et conserve les précédentes. Les modèles n'altèrent jamais montants, taxes, calculs, références ou statuts métier.

## Migration envisagée (NON appliquée)
- Conserver `role_permissions` et `organization_members` ; créer la table d'exception `user_document_permissions` (organisation, utilisateur, permission, autorisé, accordé_par, horodatages), avec RLS et garde contre l'auto-élévation.
- Étendre `document_templates` : `owner_user_id`, `status`, `visibility`, `approval_required`, `published_at`, `archived_at` ; conserver les lignes existantes et leurs identifiants.
- Ajouter `document_template_versions` immuable et `document_security_audit` append-only ; policies SELECT restreintes et aucune modification client directe.
- Autoriser uniquement des clés graphiques validées, avec garde des champs réglementaires.

## Conditions de recette bloquantes - PREUVES EXIGÉES
| N° | Critère mesurable | Preuve requise | État |
| --- | --- | --- | --- |
| 1 | 17/17 permissions documentaires appliquées et testées côté serveur | Tests unitaires + HTTP directs | À exécuter |
| 2 | 100 % scénarios interdits de la matrice refusés | Rapport 403/redirect et RPC | À exécuter |
| 3 | 100 % tentatives interentreprises refusées | Deux organisations réelles de test + RLS | À exécuter |
| 4 | Aucun rôle ne s'octroie des privilèges excessifs | Tests d'escalade et refus prioritaire | À exécuter |
| 5 | Au moins 20 scénarios de cycle de vie des templates | Suite intégration | À exécuter |
| 6 | Au moins 10 combinaisons de styles | Comparaison de rendus | À exécuter |
| 7 | 100 % logos sans déformation | Tests visuels + fichiers images | À exécuter |
| 8 | Au moins 20 PDF comparés à l'aperçu | Comparaison PDF et images multipages | À exécuter |
| 9 | Aucune mutation de montant, taxe, paie, écriture ou statut | Diff transactionnel avant/après | À exécuter |
| 10 | 100 % champs réglementaires préservés | Tests par document et juridiction | À exécuter |
| 11 | 100 % actions sensibles journalisées de façon immuable | Audit acteur/date/action/objet et RLS | À exécuter |
| 12 | Au moins 10 modifications/restaurations conformes | Suite de versions et checksum métier | À exécuter |
| 13 | 100 % comptes existants inchangés | Inventaire et comparaison des accès | À exécuter |
| 14 | 100 % tests critiques facturation/comptabilité/paie | CI complète + tests métier | À exécuter |
| 15 | p95 ≤ 2 secondes pour la sélection des templates | Mesure de charge représentative | À exécuter |
| 16 | Sauvegarde restaurée avec toutes les versions | Test de restauration isolé | À exécuter |
| 17 | UI désactive les actions interdites et serveur les refuse | E2E multi-rôles | À exécuter |
| 18 | Matrice, migration, rollback, preuves et limites publiées | Dossier de validation signé | En préparation |

## Stratégie de déploiement
1. Rendre les tests exécutables sur branche dédiée, sans migration de production.
2. Tester les changements de schéma sur base isolée restaurée ; tester 2 organisations et les comptes historiques.
3. Refuser tout merge tant qu'une seule condition bloquante échoue ou n'a pas de preuve.
4. Déployer après sauvegarde et plan de rollback testés, puis contrôler les URL et audits en production sans données simulées.
