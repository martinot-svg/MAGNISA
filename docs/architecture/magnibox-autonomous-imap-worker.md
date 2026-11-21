# MAGNIBOX — Worker IMAP autonome (phase 1)

## Objectif

Le worker est un processus serveur séparé de Next.js. Il consomme exclusivement
`magnibox_sync_outbox` via les RPC de lease Supabase déjà définies. Supabase
reste la source canonique; Dovecot/IMAP est une projection. Le worker ne lit
jamais les secrets depuis le navigateur et ne modifie ni DNS ni MX.

## Ce qui est livré dans cette phase

- Un processus Node 22 autonome avec arrêt propre sur SIGTERM/SIGINT.
- Un polling borné de l'outbox et réutilisation du moteur `runMagniboxSyncBatch`.
- Batches limités, leases/fencing tokens, backoff exponentiel avec jitter et
  dead-letter state via les RPC existantes.
- Configuration validée avec limites strictes.
- Logs JSON sans contenu de message, mots de passe, clés ou diagnostics SQL.
- Image Docker séparée et profil Compose optionnel `imap-sync`, distinct du
  worker antivirus existant.

## Limite fonctionnelle explicite

L'adaptateur Dovecot/IMAP n'est pas encore implémenté. Le runtime exige un
module serveur configuré par `MAGNIBOX_IMAP_ADAPTER_MODULE`, qui exporte
`createMagniboxImapSyncAdapter({ supabase })`. Le profil Compose refuse de
démarrer si ce module n'est pas fourni. **Ne pas activer le profil maintenant**:
aucun événement ne doit être acquitté sans un adaptateur réel et idempotent.

Le prochain lot doit ajouter:
1. Le dépôt de lecture des dossiers IMAP et de leur scope organisation/boîte.
2. Le client IMAP TLS vers Dovecot avec vérification de certificat.
3. La projection MIME des messages canoniques, avec APPEND/UIDPLUS et recherche
   de reprise après résultat ambigu.
4. L'écriture et la réconciliation des mappings UID/UIDVALIDITY.
5. Les tests d'intégration sur Dovecot isolé: doublon, crash après APPEND,
   changement UIDVALIDITY, multi-tenant et révocation d'identifiants.

Les événements `external_message`, les boîtes partagées, les flags/dossiers
personnels et les suppressions physiques restent hors du premier adaptateur.
Tout type non pris en charge doit échouer de façon explicite, jamais être
marqué comme livré.

## Configuration serveur (à préparer plus tard)

Variables utilisées par le conteneur:
- `MAGNIBOX_WORKER_SUPABASE_URL`
- `MAGNIBOX_WORKER_SERVICE_ROLE_KEY` (secret serveur uniquement)
- `MAGNIBOX_IMAP_ADAPTER_MODULE` (chemin sous `scripts/magnibox/`)
- `MAGNIBOX_IMAP_WORKER_ID`
- `MAGNIBOX_IMAP_POLL_INTERVAL_MS`
- `MAGNIBOX_IMAP_BATCH_SIZE`
- `MAGNIBOX_IMAP_LEASE_SECONDS`
- `MAGNIBOX_IMAP_MAX_ATTEMPTS`
- `MAGNIBOX_IMAP_BASE_RETRY_SECONDS`
- `MAGNIBOX_IMAP_MAX_RETRY_SECONDS`

Les clés de service ne doivent jamais être ajoutées à un fichier versionné,
une variable `NEXT_PUBLIC_*`, un journal ou un ticket.

## Validation

Tests unitaires:
```sh
npx vitest run scripts/magnibox/imap-sync-core.test.ts scripts/magnibox/imap-worker-runtime.test.ts
```

Vérification de la configuration Compose (sans démarrer de conteneur):
```sh
docker compose -f infra/magnibox-mail/compose.yaml config --quiet
```

L'image `Dockerfile.imap` est distincte de `Dockerfile`, qui continue à
exécuter le worker antivirus. Le profil `imap-sync` est optionnel et n'est pas
activé par défaut. Aucun déploiement, démarrage de service, accès au projet
Supabase connecté ou changement DNS n'est réalisé par ce code.
