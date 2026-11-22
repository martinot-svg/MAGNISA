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

## Exécution et limites fonctionnelles

Le dépôt contient un adaptateur Dovecot/IMAP concret pour la projection des
messages internes, avec transport TLS, allowlist d'hôtes, coffre de credentials,
ledger APPEND idempotent et mapping UID/UIDVALIDITY. Le worker peut fonctionner
en mode `isolated` (Supabase local) ou `production` (Supabase HTTPS).

Le mode production exige explicitement:
- `MAGNIBOX_IMAP_WORKER_MODE=production`;
- URL Supabase HTTPS (port 443) et clé de service côté serveur;
- allowlist Dovecot exacte, sans hôte loopback/local;
- keyring de credentials chiffrées et identifiant de clé actif;
- certificat CA Dovecot monté en lecture seule.

La composition Docker transmet ces paramètres au worker et le démarre avec
redémarrage automatique. Le worker ne doit jamais acquitter un événement avant
confirmation de l'adaptateur.

La portée de l'adaptateur actuel reste limitée aux messages internes canoniques.
Les événements `external_message`, les boîtes partagées, les flags/dossiers
personnels, les suppressions physiques et la réconciliation complète après
changement UIDVALIDITY ne sont pas considérés comme livrés. Tout type non
pris en charge doit échouer explicitement, jamais être marqué comme livré.

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
activé par défaut. Le code ne modifie pas le DNS. Le déploiement de production requiert un hôte mail et des paramètres externes configurés.
