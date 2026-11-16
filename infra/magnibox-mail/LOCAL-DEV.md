# MAGNIBOX — validation locale gratuite

Cette pile sert uniquement aux tests du worker de pièces jointes. Elle ne démarre
pas Postfix/Docker Mailserver, n'expose aucun port SMTP et ne modifie aucun DNS/MX.
Elle utilise le projet Supabase local défini dans `supabase/config.toml`.

## Prérequis

- Docker avec Docker Compose v2
- Supabase CLI
- Node.js 22 et npm
- Dépendances du dépôt installées avec `npm ci`

## Démarrage

Depuis la racine du dépôt :

1. Démarrer Supabase local et appliquer les migrations :

   ```sh
   supabase start
   supabase db reset
   supabase status
   ```

2. Copier le modèle d'environnement :

   ```sh
   cp infra/magnibox-mail/.env.local-dev.example infra/magnibox-mail/.env.local-dev
   ```

3. Remplacer `MAGNIBOX_WORKER_SERVICE_ROLE_KEY` dans le fichier local par la clé
   `service_role` fournie par `supabase status`. Garder cette clé côté serveur :
   ne pas la committer, ne pas la mettre dans une variable `NEXT_PUBLIC_*`, ni
   l'utiliser dans le navigateur.

4. Construire et démarrer uniquement ClamAV et le worker :

   ```sh
   docker compose -f infra/magnibox-mail/compose.local.yaml up --build -d
   docker compose -f infra/magnibox-mail/compose.local.yaml logs -f attachment-worker
   ```

Le service worker utilise `host.docker.internal:54321` pour joindre Supabase
local et le réseau Compose privé pour joindre ClamAV. Sur Linux, Compose ajoute
la résolution `host-gateway`. Le port 3310 de ClamAV n'est pas publié sur l'hôte.

## Vérifications et arrêt

Les tests unitaires du protocole et de la détection de fichiers sont exécutés par
`npm test`. Pour les lancer seuls :

```sh
npx vitest run scripts/magnibox/attachment-scan-core.test.ts
```

Vérifier les journaux du worker et l'état des lignes de test dans
`orbit_external_message_attachments`. Préparer les objets et métadonnées de test
dans le projet local uniquement, avec des identifiants d'organisation/message
valides. Vérifier qu'un fichier ne devient `available` qu'après verdict ClamAV
propre et mise à jour protégée par le jeton de lease.

Arrêter la pile :

```sh
docker compose -f infra/magnibox-mail/compose.local.yaml down
supabase stop
```

Pour supprimer aussi la base de signatures antivirus locale :

```sh
docker compose -f infra/magnibox-mail/compose.local.yaml down -v
```

## Limites

- Ce parcours valide le worker et le stockage local ; il ne prouve pas la réception
  SMTP publique ni la délivrabilité Internet.
- Il n'envoie aucun e-mail et ne touche pas aux MX.
- Les tests d'intégration de scénarios réels (fichier propre/infecté, accès RLS,
  reprise et concurrence) doivent être exécutés sur des données locales dédiées
  avant de déclarer la campagne d'intégration terminée.
- Ne jamais connecter ce worker de test à un projet Supabase de production.
