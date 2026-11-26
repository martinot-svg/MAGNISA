# 04 — Spécification complète de création d'une organisation

## 1. Principe

Étendre le wizard existant `CompanyCreationWizard`. Ne pas le remplacer. Préserver le schéma Zod, l'action serveur, la RPC SQL, `create_organization()`, les politiques de stockage du logo et les paramètres existants.

## 2. Étape 1 — Identité de l'organisation

Champs existants à conserver :
- Raison sociale / nom de l'organisation (obligatoire).
- Nom commercial.
- Slogan.
- Logo couleur.
- Logo inverse.
- Secteur d'activité (obligatoire).
- Sous-secteur.
- Activité principale (obligatoire).
- Activités secondaires.

Règles :
- Logo facultatif ; PNG, JPEG, WebP selon les limites du stockage configuré.
- Conserver le stockage privé `organization-branding`.
- Conserver l'extraction de palette et la possibilité de réessayer un import après création.
- Ne pas créer une seconde organisation si l'import du logo échoue.
- Les secteurs et activités viennent du catalogue existant ; ne pas inventer un code NOMAC officiel.
- Le nom commercial et le slogan restent facultatifs.

## 3. Étape 2 — Situation juridique

Champs existants à conserver :
- Forme juridique.
- Situation administrative : déjà immatriculée ou en cours de formalisation/non immatriculée.
- NIF.
- STAT.
- RCS.

Règles :
- Réutiliser les propriétés déjà présentes.
- Ne pas dupliquer NIF ou RCS dans une seconde zone du formulaire.
- Les numéros sont déclaratifs ; MAGNISA ne doit pas prétendre les avoir vérifiés auprès d'une administration.
- Si « déjà immatriculée », présenter les champs de référence sans les rendre obligatoires tant que la politique produit ne l'exige pas.
- La date d'immatriculation sera proposée dans l'étape complémentaire.
- « Numéro d'immatriculation » doit être clarifié : ne pas le confondre automatiquement avec le RCS, NIF ou STAT.

## 4. Étape 3 — Localisation et contacts

Champs existants à conserver :
- Pays.
- Région.
- Ville/commune/localité.
- Adresse.
- Téléphone professionnel.
- E-mail professionnel.

Règles :
- Ces coordonnées concernent l'organisation, pas la résidence personnelle du créateur.
- Ne pas réutiliser les données de résidence du profil personnel par défaut sans consentement explicite.
- Garder le référentiel géographique et les suggestions actuelles.
- Si l'utilisateur saisit un village non référencé, ne pas lui attribuer une commune ou un district fictif.
- Le pays et les règles de validation doivent rester compatibles avec le périmètre géographique réellement pris en charge.

## 5. Étape 4 — Fiscalité et comptabilité

Champs existants :
- Régime fiscal déclaré.
- Situation TVA.
- Début de l'exercice comptable.
- Fin de l'exercice comptable.
- Devise de gestion.
- Indicateur de comptes existants.

Règles :
- Réutiliser le champ `taxRegime` et les colonnes de `company_settings`.
- Ne pas ajouter un second champ IR/IS dans l'étape complémentaire.
- Le statut fiscal reste déclaratif tant qu'une vérification n'a pas été effectuée.
- Les dates doivent être des dates calendaires valides et la fin doit être postérieure au début.
- La devise reste limitée aux valeurs autorisées par le schéma et la RPC existants, sauf décision séparée.

**Blocage métier :** le code actuel affiche `IS — Impôt synthétique`. Le libellé et la nomenclature doivent être vérifiés par une personne compétente pour le droit fiscal malgache avant modification. Ne pas remplacer le texte par une supposition. Prévoir une option « À confirmer » qui n'attribue pas de régime erroné.

## 6. Étape 5 — Informations complémentaires (facultatif)

### Texte

Titre : **Informations complémentaires**

Description :
« Renseignez les informations disponibles pour compléter le dossier de votre organisation. Vous pourrez les modifier ou les compléter plus tard dans les paramètres. »

Aucun astérisque, aucun label répétant « facultatif ».

### 6.1 Immatriculation et administration

| Champ | Type | Règle |
|---|---|---|
| Numéro d'immatriculation | Texte | Facultatif ; définition métier à valider |
| RCS | Texte | Réutiliser `rcs` existant, ne pas dupliquer |
| Date d'immatriculation | Date | Facultative ; date valide, pas future sauf cas documenté |
| NIF | Texte | Réutiliser `nif` existant |
| STAT | Texte | Réutiliser `stat` existant |
| Effectif | Entier ou tranche | Facultatif ; zéro autorisé seulement si la définition métier le permet |

Le formulaire ne doit pas demander de document juridique à téléverser. L'utilisateur saisit uniquement les informations dans les champs.

### 6.2 Banque

Champs souhaités :
- Nom de la banque.
- Nom du titulaire du compte.
- Numéro de compte.
- RIB.

Règles de sécurité obligatoires :
- Ces données ne doivent pas être placées dans `onboarding_profile` JSON général.
- Prévoir un stockage structuré et séparé, avec permissions spécifiques.
- Pas d'accès aux membres ordinaires.
- Accès réservé aux rôles explicitement autorisés par la politique métier.
- Masquer le numéro de compte et le RIB dans les écrans non privilégiés.
- Ne jamais journaliser les valeurs complètes.
- Ne jamais envoyer ces champs dans les analytics ou les logs d'erreur.
- Prévoir audit des consultations/modifications si les données sont réellement utilisées.
- Chiffrement au repos selon les capacités de la plateforme et politique de gestion des clés.
- Ne pas demander les informations bancaires si aucune fonctionnalité ne les utilise encore ; possibilité de les compléter plus tard.

### 6.3 Affiliations sociales

Champs :
- Organismes concernés : CNAPS, OSTIE, autre.
- Numéro d'affiliation correspondant à chaque organisme choisi.

Règles :
- Autoriser plusieurs organismes.
- Ne pas stocker tous les numéros dans un seul texte libre.
- Prévoir une structure liée à l'organisation, un type d'organisme et une référence.
- Pour « autre », demander le nom de l'organisme.
- Les numéros sont déclaratifs et ne sont pas validés auprès de l'organisme par MAGNISA.
- Restreindre l'accès aux personnes autorisées à gérer les informations sociales.
- Éviter les données personnelles des salariés dans cette étape : il s'agit uniquement des références d'affiliation de l'organisation.

### 6.4 Comportement facultatif

Boutons :
- **Ignorer cette étape**
- **Enregistrer et continuer**

Ignorer :
- ne bloque pas ;
- ne crée aucune donnée fictive ;
- conserve les valeurs des étapes précédentes ;
- inscrit l'état de complétion comme « ignoré » ou « à compléter », si un suivi d'onboarding est nécessaire.

Enregistrer et continuer :
- valide uniquement les champs renseignés ;
- permet les champs entièrement vides ;
- si un champ est commencé, valide son format ;
- enregistre les données autorisées ;
- ne rend pas les données bancaires visibles à des rôles non autorisés.

## 7. Étape 6 — Vérification et création

- Afficher un résumé complet des informations saisies.
- Identifier les rubriques non renseignées sans les présenter comme erreurs.
- Permettre de revenir à une étape sans perdre les saisies.
- Faire confirmer la création.
- Appeler l'action serveur existante.
- La RPC SQL reste la source de vérité pour les validations critiques.
- La création de l'organisation et l'attribution du rôle initial doivent rester transactionnelles selon le mécanisme existant.
- Ne pas considérer un échec d'upload logo comme un échec de création d'organisation.
- Rediriger vers le tableau de bord/paramètres après succès.

## 8. Paramètres après création

Créer ou réutiliser des rubriques dédiées :
- Identité et coordonnées.
- Situation juridique.
- Fiscalité et comptabilité.
- Informations bancaires (permission spécifique).
- Affiliations sociales (permission spécifique).

Les champs doivent être modifiables avec validation serveur. Les données sensibles ne doivent pas être exposées via une requête générale `company_settings` accessible à tous les membres.

## 9. Critères d'acceptation

- Les cinq étapes existantes restent fonctionnelles ; la nouvelle étape est ajoutée sans régression.
- Les champs déjà présents ne sont pas dupliqués.
- Les champs facultatifs peuvent être ignorés.
- Aucun document juridique n'est demandé.
- Les données bancaires et sociales ont des contrôles d'accès dédiés.
- Les données déclaratives ne sont pas présentées comme certifiées.
- Le rôle Administrateur principal est conservé selon la fonction existante.
- Un échec de logo n'entraîne pas une seconde création.
