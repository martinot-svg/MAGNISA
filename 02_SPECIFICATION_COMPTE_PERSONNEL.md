# 02 — Spécification complète du compte personnel

## Phase 1 — Créer votre espace personnel

### Texte de l'écran

**Bienvenue sur MAGNISA**

« Créez votre compte personnel unique pour accéder à l'écosystème MAGNISA. »

### Champs

| Champ | Requis | Contrôle attendu |
|---|---:|---|
| Prénom | Oui | 1 à 60 caractères, trim, caractères Unicode autorisés |
| Nom | Oui | 1 à 60 caractères, trim |
| Nom d'utilisateur MAGNISA | Oui | 3 à 10 lettres minuscules ASCII, unicité garantie côté serveur |
| Adresse e-mail personnelle | Oui | E-mail valide, normalisation minuscule, politique anti-abus existante |
| Téléphone | Oui | Indicatif pays + numéro national, normalisation E.164 côté serveur |
| Date de naissance | Oui | Date réelle, non future, âge minimum selon décision produit/juridique |
| Région de résidence | Oui | Région choisie dans le référentiel officiel retenu |
| Ville/localité de résidence | Oui | Localité liée à la région, sélection ou saisie selon couverture du référentiel |

### Téléphone

- Madagascar `+261` proposé par défaut, sans empêcher les autres pays.
- Sélecteur de pays et indicatif international.
- Saisie du numéro national dans un champ distinct visuellement.
- Normaliser et valider côté serveur ; ne pas faire confiance au navigateur.
- Ne pas déduire l'opérateur uniquement du préfixe : portabilité possible.
- Éviter de stocker deux représentations contradictoires du même numéro.
- Index unique seulement si la règle métier exige réellement un téléphone unique ; ne pas imposer cette contrainte sans décision.

### Nom d'utilisateur

- Suggestion générée à partir du prénom et du nom.
- L'utilisateur peut modifier la suggestion.
- Préfixe `@` présenté visuellement, non stocké dans la valeur canonique.
- 3 à 10 lettres minuscules, sans espace, chiffre ni ponctuation selon la règle demandée.
- Disponibilité vérifiée côté serveur.
- Réservation atomique en base : deux inscriptions simultanées ne peuvent pas obtenir le même identifiant.
- En cas de conflit, proposer des variantes et permettre de choisir une autre valeur.
- La valeur affichée après création doit être celle réellement persistée.
- Préserver la compatibilité des anciens usernames et la règle de cooldown existante.

### Résidence et origine d'inscription

Deux ensembles différents :
- **Origine d'inscription** : donnée privée, historique et immuable selon la politique déjà présente.
- **Résidence actuelle** : donnée de profil modifiable, utilisée seulement pour les fonctionnalités qui en ont besoin.

Ne jamais :
- remplacer l'origine par la résidence ;
- fusionner les deux colonnes ;
- envoyer les codes de géographie dans `raw_user_meta_data` ;
- exposer l'origine dans les profils publics ou aux administrateurs d'organisation.

### Phase 2 — Sécuriser votre compte

Écran : **Sécuriser votre compte**

Champs :
- Mot de passe.
- Confirmation du mot de passe.

Règles :
- Supabase Auth reste le fournisseur d'identité.
- Aucun mot de passe en clair dans `profiles`, une table métier, un log ou un événement analytique.
- Vérification côté serveur.
- Confirmation identique au mot de passe.
- Politique de complexité à aligner sur les paramètres Supabase Auth du projet ; ne pas maintenir une règle UI différente de la règle serveur.
- Messages d'erreur utiles, sans révéler d'information sensible.
- Protection contre les tentatives répétées selon les limites Supabase et les mécanismes déjà en place.

La politique actuelle audité indique au moins 10 caractères dans le formulaire et le schéma serveur. La décision de maintenir ou renforcer cette politique doit être appliquée à la fois dans l'interface et dans Auth.

### Phase 3 — Vérifier votre adresse e-mail

Écran : **Vérifier votre adresse e-mail**

- Envoi du code de confirmation à six chiffres.
- Afficher l'adresse e-mail cible.
- Champ de code numérique de six chiffres.
- Prise en charge de l'autoremplissage OTP lorsque disponible.
- Bouton de vérification.
- Renvoi du code avec temporisation.
- Expiration et nombre de tentatives gérés côté fournisseur/serveur.
- Réponse générique lorsque le code est incorrect ou expiré.
- Redirection vers le choix d'utilisation après vérification.
- Un compte non vérifié ne doit pas accéder aux fonctionnalités protégées.

Le mécanisme Supabase Auth existant doit être conservé si sa configuration correspond bien à l'OTP six chiffres attendu. Ne pas introduire un second système OTP artisanal.

### Phase 4 — Choisir votre utilisation de MAGNISA

Écran détaillé dans `03_SPECIFICATION_CHOIX_MAGNISA.md`.

## Profil personnel après inscription

Les informations complémentaires ne doivent être demandées que lorsqu'une fonctionnalité les utilise. Les données personnelles modifiables doivent disposer :
- d'une validation serveur ;
- d'un écran de modification ;
- d'un historique minimal lorsque cela est nécessaire ;
- d'une politique de visibilité explicite ;
- d'une politique de suppression/conservation conforme aux obligations applicables.

## Critères d'acceptation du compte personnel

- Un utilisateur peut créer un compte sans organisation.
- L'adresse e-mail doit être vérifiée avant l'accès protégé.
- Téléphone, date de naissance et résidence sont enregistrés dans les champs dédiés, si l'audit confirme leur absence.
- L'origine privée existante reste intacte.
- Le nom d'utilisateur est identique dans l'UI et en base.
- Les anciens comptes continuent de se connecter.
- Le public ID 14 chiffres reste inchangé.
- Les mots de passe ne sont jamais stockés dans les tables applicatives.
