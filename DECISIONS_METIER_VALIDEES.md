# MAGNISA --- DÉCISIONS MÉTIER VALIDÉES

**Document :** `DECISIONS_METIER_VALIDEES.md`\
**Projet :** MAGNISA\
**Version :** 1.0\
**Date :** 27 novembre 2026\
**Statut :** Décisions métier validées --- intégration technique à
réaliser

------------------------------------------------------------------------

## 1. Objet du document

Ce document centralise les six décisions métier validées pour MAGNISA.

Il constitue la référence pour : - Les prochaines évolutions
fonctionnelles. - La conception des modifications Supabase. - Les règles
de permissions et de sécurité. - Les validations frontend et backend. -
Les tests automatisés. - Les critères de recette. - La documentation
juridique et la politique de confidentialité.

**Important :** une décision métier validée n'est pas une fonctionnalité
techniquement implémentée ni une conformité juridique démontrée.

Aucune modification de production ne doit être considérée comme
autorisée uniquement par ce document.

## 2. Registre des décisions validées

  -----------------------------------------------------------------------
  Identifiant             Sujet                   Décision
  ----------------------- ----------------------- -----------------------
  D-01                    Âge minimum             18 ans minimum, calculé
                                                  à partir de la date de
                                                  naissance

  D-08                    Immatriculation         Facultative à la
                                                  création, configurable
                                                  ultérieurement

  D-09                    Régime fiscal           Facultatif à la
                                                  création, configurable
                                                  ultérieurement

  D-12                    Données bancaires       Accès selon permissions
                                                  explicites

  D-14                    Données sociales        Accès selon permissions
                                                  RH et sociales
                                                  spécifiques

  D-15                    Suppression des données Suppression
                                                  différenciée et
                                                  conservation justifiée
  -----------------------------------------------------------------------

## 3. D-01 --- Âge minimum de 18 ans

### Décision métier

Toute personne doit avoir au moins 18 ans pour créer et utiliser un
compte MAGNISA.

Cette règle s'applique à : - La création d'un compte personnel. - La
création d'une organisation. - L'administration d'une organisation. -
L'adhésion à une équipe. - L'acceptation d'une invitation. - L'accès aux
fonctionnalités financières personnelles.

### Exigences fonctionnelles

Le formulaire d'inscription doit intégrer : - Une date de naissance
obligatoire. - Une déclaration explicite de majorité. - Une validation
automatique de l'âge.

Texte de confirmation :

> Je confirme que les informations fournies sont exactes et que j'ai au
> moins 18 ans.

### Règles de calcul

Le serveur doit : 1. Vérifier que la date de naissance est valide. 2.
Refuser les dates futures. 3. Calculer l'âge à partir de la date
courante. 4. Vérifier que la personne a effectivement atteint son 18e
anniversaire. 5. Vérifier la confirmation explicite de majorité.

La validation ne doit pas se limiter à une soustraction entre les années
civiles. La règle de calcul des anniversaires du 29 février doit
également être documentée.

### Règles de sécurité

-   Contrôle frontend et backend.
-   Aucun contournement par invitation.
-   Aucune création de compte si le contrôle échoue.
-   Aucune confiance accordée à une valeur d'âge fournie directement par
    le navigateur.
-   Protection de la date de naissance contre les accès non autorisés.
-   Collecte et conservation limitées à ce qui est nécessaire.

La date de naissance déclarée ne constitue pas une preuve d'identité.

### Critères de recette

-   Un utilisateur de 17 ans est refusé.
-   Un utilisateur ayant exactement 18 ans est accepté.
-   Un utilisateur de plus de 18 ans est accepté.
-   Une date future est refusée.
-   Une date invalide est refusée.
-   L'absence de déclaration bloque l'inscription.
-   Une invitation ne permet pas de contourner le contrôle.
-   Une requête backend directe ne permet pas de créer un compte non
    conforme.

## 4. D-08 --- Numéro d'immatriculation de l'organisation

### Décision métier

Le numéro d'immatriculation est facultatif lors de la création de
l'organisation.

Il pourra être renseigné ou modifié ultérieurement dans les paramètres
de l'organisation.

### Exigences fonctionnelles

Lors de la création : - Le nom légal est renseigné. - Le pays
d'enregistrement est renseigné. - Le numéro d'immatriculation reste
facultatif. - L'absence de numéro ne bloque pas l'onboarding.

Emplacement de configuration :

**Paramètres → Organisation → Informations légales**

Informations prévues : - Type d'identifiant. - Numéro
d'immatriculation. - Pays d'enregistrement. - Autorité ou registre
émetteur, lorsque nécessaire. - Date d'enregistrement, si disponible.

### Règles de gestion

-   Ne pas imposer un format universel.
-   Adapter les formats aux juridictions.
-   Distinguer le numéro d'immatriculation du numéro fiscal.
-   Ne pas confondre une information déclarée et une information
    vérifiée.
-   Prévoir une modification ultérieure.
-   Conserver une trace des modifications importantes.

Une fonctionnalité réglementée pourra exiger un identifiant légal avant
son activation lorsque cela est justifié.

### Critères de recette

-   Une organisation peut être créée sans numéro.
-   Le numéro peut être ajouté ultérieurement.
-   Le numéro peut être modifié par un utilisateur autorisé.
-   Un utilisateur non autorisé ne peut pas modifier les informations
    légales.
-   Les modifications sont journalisées.
-   L'absence de numéro ne bloque pas les fonctionnalités ordinaires qui
    n'en dépendent pas.

## 5. D-09 --- Régimes fiscaux

### Décision métier

Le régime fiscal est facultatif lors de la création de l'organisation.

Il est configurable ultérieurement dans les paramètres fiscaux.

### Emplacement fonctionnel

**Paramètres → Organisation → Fiscalité**

Informations envisagées : - Pays de résidence fiscale. - Régime
fiscal. - Identifiant fiscal lorsque nécessaire. - Date de prise
d'effet. - Date de fin d'application, si applicable. - Informations
complémentaires.

### Règles de gestion

-   Ne pas imposer IR ou IS lors de l'onboarding.
-   Ne pas considérer IR et IS comme les seuls régimes possibles.
-   Adapter les options au pays et à la forme juridique.
-   Permettre la modification par les utilisateurs autorisés.
-   Conserver l'historique des changements.
-   Distinguer le régime déclaré du régime officiellement vérifié.
-   Ne pas effectuer de calcul fiscal sans règles réglementaires
    adaptées.

Le référentiel fiscal devra être extensible et versionnable.

### Critères de recette

-   Une organisation peut être créée sans régime fiscal.
-   Le régime peut être renseigné ultérieurement.
-   Les modifications sont contrôlées par permissions.
-   L'historique des changements est disponible aux utilisateurs
    autorisés.
-   Les paramètres fiscaux d'une organisation ne sont pas accessibles à
    une autre organisation.

## 6. D-12 --- Accès aux données bancaires

### Décision métier

MAGNISA applique le principe du moindre privilège.

L'accès aux informations bancaires dépend des permissions explicitement
attribuées.

### Matrice fonctionnelle

  Rôle                    Politique d'accès
  ----------------------- ---------------------------------------
  Propriétaire            Contrôle complet des autorisations
  Administrateur          Selon permissions attribuées
  Responsable financier   Selon responsabilités
  Comptable               Données nécessaires à la comptabilité
  Collaborateur           Aucun accès par défaut

### Permissions granulaires

Les permissions doivent être séparées selon les opérations : -
`bank_accounts.view` - `bank_balances.view` - `bank_transactions.view` -
`bank_statements.view` - `bank_details.view` - `bank_permissions.manage`

Les identifiants définitifs devront être harmonisés avec le système de
permissions existant.

### Règles de gestion

-   Aucun accès bancaire automatique.
-   Le propriétaire contrôle les autorisations.
-   Un administrateur ne peut gérer les permissions bancaires que s'il
    possède une autorisation explicite.
-   Les permissions peuvent être retirées.
-   Les accès sont contrôlés côté serveur.
-   Les données sont isolées par organisation.
-   Les opérations sensibles sont journalisées.

### Critères de recette

-   Un collaborateur sans permission ne consulte aucune donnée bancaire.
-   Un responsable financier accède uniquement aux ressources
    autorisées.
-   Un comptable ne reçoit pas automatiquement tous les droits
    bancaires.
-   Un administrateur sans permission de gestion ne peut pas attribuer
    des droits bancaires.
-   Le propriétaire peut accorder et retirer les permissions.
-   Une modification de permission est appliquée immédiatement aux
    contrôles serveur.
-   Aucun accès interorganisation n'est possible.

## 7. D-14 --- Accès aux données sociales

### Décision métier

Les données sociales et RH sont protégées par des permissions
spécifiques.

Le principe du moindre privilège s'applique également à ce domaine.

### Matrice fonctionnelle

  -----------------------------------------------------------------------
  Rôle                                Politique d'accès
  ----------------------------------- -----------------------------------
  Propriétaire                        Contrôle des autorisations

  Administrateur                      Selon permissions attribuées

  Responsable RH                      Données RH autorisées

  Responsable paie                    Données nécessaires à la paie

  Comptable                           Données nécessaires à la
                                      comptabilité

  Collaborateur                       Ses propres informations selon les
                                      fonctionnalités disponibles
  -----------------------------------------------------------------------

### Permissions granulaires

Permissions envisagées : - `hr_employees.view` - `hr_employees.manage` -
`hr_contracts.view` - `hr_contracts.manage` - `payroll.view` -
`payroll.manage` - `employee_documents.view` -
`employee_documents.manage` - `employee_own_data.view` -
`hr_permissions.manage`

Ces permissions devront être rapprochées des ressources et conventions
existantes.

### Règles de gestion

-   Aucun accès RH automatique.
-   Séparation des droits RH, paie, contrats et documents.
-   Le propriétaire contrôle les autorisations.
-   Les administrateurs disposent uniquement des droits explicitement
    délégués.
-   Un collaborateur ne peut consulter que ses propres informations
    selon les fonctionnalités disponibles.
-   Les accès et modifications sensibles sont journalisés.
-   Les contrôles sont appliqués côté serveur.
-   L'isolation entre organisations est obligatoire.

### Critères de recette

-   Un collaborateur ne peut pas consulter le dossier d'un autre
    salarié.
-   Un responsable paie ne reçoit pas automatiquement tous les droits
    RH.
-   Un comptable n'accède qu'aux données nécessaires à ses missions.
-   Un administrateur sans permission ne peut pas consulter les
    bulletins de paie.
-   Les accès sont immédiatement révoqués après retrait des permissions.
-   Les données sociales restent isolées entre organisations.

## 8. D-15 --- Suppression et conservation des données

### Décision métier

MAGNISA applique une suppression différenciée.

Les données personnelles peuvent être supprimées ou anonymisées lorsque
cela est possible et justifié.

Les données d'organisation, comptables, sociales et de sécurité peuvent
être conservées lorsqu'une obligation légale, contractuelle ou une autre
base légitime le justifie.

### Catégories de données

  -----------------------------------------------------------------------
  Catégorie                           Politique
  ----------------------------------- -----------------------------------
  Compte personnel                    Suppression ou désactivation selon
                                      le processus applicable

  Profil personnel                    Suppression des informations qui ne
                                      sont plus nécessaires

  Données d'organisation              Conservation justifiée

  Documents comptables                Conservation selon les obligations
                                      applicables

  Données sociales                    Conservation selon les obligations
                                      applicables

  Journaux de sécurité                Conservation limitée et documentée
  -----------------------------------------------------------------------

### Règles fonctionnelles

-   La suppression du compte ne doit pas supprimer automatiquement les
    données de l'organisation.
-   La désactivation d'un membre doit préserver les ressources
    collectives.
-   Les données personnelles non nécessaires doivent être supprimées ou
    anonymisées.
-   Les données soumises à une obligation de conservation doivent être
    protégées.
-   Les durées de conservation doivent être définies par catégorie et
    juridiction.
-   Les accès doivent être révoqués conformément au processus de
    fermeture.
-   Les demandes de suppression doivent être traçables.
-   Les exceptions de conservation doivent être documentées.

### Critères de recette

-   La fermeture d'un compte révoque ses accès.
-   Les documents comptables de l'organisation restent disponibles aux
    utilisateurs autorisés.
-   Les dossiers RH soumis à conservation sont préservés.
-   Les données personnelles supprimables sont traitées.
-   Les journaux conservés ne contiennent pas inutilement des
    informations personnelles.
-   Une demande de suppression peut être suivie.
-   Les données conservées disposent d'une justification et d'une durée
    documentées.

## 9. Exigences Supabase

Cette section définit les exigences cibles. Elle ne prescrit pas de
créer de nouvelles tables si les structures existantes permettent déjà
de satisfaire les règles.

Toute évolution doit commencer par l'inspection du schéma actuel.

### 9.1 Architecture de données

Les structures existantes devront être examinées pour identifier les
emplacements appropriés.

Structures fonctionnelles à couvrir :

  -----------------------------------------------------------------------
  Domaine                             Informations nécessaires
  ----------------------------------- -----------------------------------
  Identité                            Date de naissance et état de
                                      validation de majorité

  Organisation                        Numéro d'immatriculation et pays

  Fiscalité                           Régimes, identifiants et historique

  Permissions bancaires               Droits par membre et organisation

  Permissions sociales                Droits RH et paie par membre et
                                      organisation

  Audit                               Acteur, action, ressource,
                                      organisation et horodatage

  Suppression                         État de la demande et traitement
                                      des catégories de données
  -----------------------------------------------------------------------

Les noms des tables et colonnes seront déterminés après comparaison avec
les migrations existantes.

### 9.2 Modèle de permissions

Le modèle doit respecter les principes suivants : 1. Chaque permission
est associée à une organisation. 2. Chaque attribution est associée à un
membre autorisé. 3. Les permissions sont granulaires. 4. Le rôle ne doit
pas constituer l'unique mécanisme d'autorisation. 5. Le propriétaire
dispose du contrôle prévu par la politique métier. 6. Les
administrateurs ne peuvent déléguer que les droits explicitement
autorisés. 7. Les autorisations ne doivent jamais traverser les
frontières des organisations.

### 9.3 Politiques RLS

Les politiques RLS devront garantir : - L'isolation stricte des
organisations. - Le refus par défaut en l'absence de politique
autorisant l'accès. - La vérification des permissions pour chaque
ressource sensible. - La séparation entre consultation et
modification. - La protection des données personnelles. - La protection
des données bancaires. - La protection des données RH et de paie. - La
protection des journaux d'audit.

Aucune donnée sensible ne doit être accessible uniquement parce qu'un
utilisateur est authentifié.

Les fonctions `SECURITY DEFINER` devront faire l'objet d'un examen
particulier : `search_path`, contrôle de l'identité appelante,
validation de l'appartenance à l'organisation et contrôle des
permissions.

### 9.4 Journalisation

Les opérations sensibles à journaliser comprennent : - Modification de
date de naissance ou de données d'identité. - Modification des
informations légales. - Modification du régime fiscal. - Attribution ou
retrait d'une permission bancaire. - Attribution ou retrait d'une
permission sociale. - Consultation de ressources particulièrement
sensibles lorsque justifiée. - Demande de suppression. - Suppression,
anonymisation ou conservation exceptionnelle.

Les journaux doivent contenir le minimum nécessaire : - Identifiant de
l'organisation. - Identifiant de l'acteur. - Type d'action. - Type et
identifiant de la ressource. - Date et heure. - Résultat de
l'opération. - Motif ou contexte lorsque nécessaire.

Ne jamais journaliser les mots de passe, jetons d'authentification,
données bancaires complètes ou contenus sensibles inutiles.

Les journaux doivent être protégés contre la modification non autorisée.

## 10. Validations frontend et backend

### 10.1 Frontend

Le frontend doit : - Présenter les champs et confirmations
obligatoires. - Fournir des messages d'erreur compréhensibles. - Ne pas
afficher les fonctionnalités interdites à l'utilisateur. - Distinguer
les informations obligatoires des informations facultatives. - Afficher
les permissions effectives. - Empêcher les actions manifestement non
autorisées dans l'interface.

Cependant, masquer un bouton ne constitue jamais une protection
suffisante.

### 10.2 Backend

Le backend constitue la source d'autorité.

Il doit : - Recalculer l'âge. - Vérifier la majorité avant la création
effective du compte. - Vérifier les permissions à chaque opération
sensible. - Vérifier l'appartenance à l'organisation. - Valider les
changements fiscaux et légaux. - Contrôler les demandes de
suppression. - Enregistrer les opérations sensibles. - Empêcher toute
élévation de privilèges.

Les validations doivent être indépendantes des valeurs affichées dans le
navigateur.

## 11. Tests automatisés

### 11.1 Tests D-01

-   Âge inférieur à 18 ans.
-   Exactement 18 ans.
-   Anniversaire non encore atteint.
-   Anniversaire du 29 février.
-   Date future.
-   Date invalide.
-   Déclaration absente.
-   Création directe via API.
-   Inscription via invitation.

### 11.2 Tests D-08 et D-09

-   Création sans immatriculation.
-   Ajout ultérieur de l'immatriculation.
-   Modification par un utilisateur autorisé.
-   Refus pour un utilisateur non autorisé.
-   Création sans régime fiscal.
-   Configuration ultérieure du régime.
-   Historique des changements.
-   Isolation des données entre organisations.

### 11.3 Tests D-12 et D-14

-   Accès sans permission.
-   Accès avec permission.
-   Retrait d'une permission.
-   Délégation autorisée.
-   Délégation non autorisée.
-   Accès interorganisation.
-   Accès aux bulletins de paie.
-   Accès aux données bancaires.
-   Accès aux données personnelles d'un autre collaborateur.

### 11.4 Tests D-15

-   Suppression d'un compte personnel.
-   Révocation des accès.
-   Conservation des documents comptables.
-   Conservation justifiée des données sociales.
-   Traitement des données personnelles supprimables.
-   Conservation limitée des journaux de sécurité.
-   Suivi d'une demande de suppression.

## 12. Critères généraux de recette

La mise en production des évolutions nécessitera : - Tests automatisés
réussis. - Rejeu complet des migrations PostgreSQL. - Vérification des
politiques RLS. - Vérification des fonctions sensibles. - Tests de
séparation multi-organisation. - Tests frontend et backend. - Tests des
invitations. - Tests des rôles et permissions. - Tests de suppression
différenciée. - Vérification de l'absence de régression sur les parcours
existants. - Revue des exigences d'accessibilité applicables. -
Validation des documents juridiques concernés.

Les résultats doivent être documentés et reproductibles.

## 13. Documentation juridique et conformité

La documentation devra être adaptée aux juridictions réellement ciblées.

Documents à examiner : - Conditions générales d'utilisation. - Politique
de confidentialité. - Politique de conservation et suppression. -
Information relative aux données de salariés. - Documentation des
permissions. - Politique de sécurité et de journalisation. - Éventuels
accords de traitement des données.

Pour chaque juridiction, il faudra vérifier : - L'âge minimum et les
règles contractuelles. - Les exigences applicables aux données
personnelles. - Les obligations de conservation comptable. - Les
obligations relatives aux dossiers sociaux. - Les règles de
confidentialité bancaire. - Les exigences de sécurité et de notification
d'incidents.

Aucune conformité ne doit être déclarée sans vérification juridique
adaptée.

## 14. Ordre recommandé d'intégration

  -----------------------------------------------------------------------
  Phase                   Travail                 Résultat attendu
  ----------------------- ----------------------- -----------------------
  1                       Inspection du schéma et Diagnostic ciblé
                          des politiques          
                          existantes              

  2                       Formalisation du modèle Architecture validée
                          de données              

  3                       Implémentation D-01     Contrôle de majorité

  4                       Implémentation D-08 et  Informations légales et
                          D-09                    fiscales

  5                       Implémentation D-12     Permissions bancaires

  6                       Implémentation D-14     Permissions sociales

  7                       Implémentation D-15     Suppression
                                                  différenciée

  8                       Tests automatisés et    Preuves de validation
                          sécurité                

  9                       Documentation juridique Documents actualisés

  10                      Recette et déploiement  Clôture des évolutions
                          contrôlé                
  -----------------------------------------------------------------------

Les phases pourront être regroupées lorsque les dépendances techniques
le permettent.

## 15. Règles de gouvernance du document

-   Toute modification métier doit être approuvée avant intégration.
-   Les exigences techniques peuvent être adaptées pour respecter
    l'architecture existante, sans modifier la décision métier.
-   Toute divergence doit être documentée.
-   Les migrations doivent être réversibles lorsque cela est
    techniquement possible.
-   Les données de production doivent être préservées.
-   Les politiques RLS ne doivent jamais être désactivées pour faciliter
    une évolution.
-   Les tests doivent être exécutés avant déploiement.
-   Une décision métier ne devient une fonctionnalité validée qu'après
    réalisation et recette.

## Statut final

**Six décisions métier validées.**

**Formalisation des exigences : définie dans ce document.**

**Implémentation Supabase : à réaliser et à vérifier.**

**Tests automatisés : à préparer et à exécuter.**

**Conformité juridique : à vérifier par juridiction.**

**Mise en production : non autorisée par la seule validation de ce
document.**

------------------------------------------------------------------------

**Fin du document --- MAGNISA / DECISIONS_METIER_VALIDEES.md**
