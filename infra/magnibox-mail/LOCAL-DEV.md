# MAGNIBOX — validation locale gratuite

Cette pile sert uniquement aux tests du worker de pièces jointes. Elle ne démarre
pas Postfix/Docker Mailserver, n'expose aucun port SMTP et ne modifie aucun DNS/MX.
Elle utilise le projet Supabase local défini dans supabase/config.toml.

## Prérequis

- Docker avec Docker Compose v2
- Supabase CLI
- Node.js 22 et npm
- Dépendances du dépôt installées avec npm ci

## Test de bout en bout

Depuis la racine du dépôt :

1. Démarrer Supabase local et appliquer les migrations :

   supabase start
   supabase db reset
   supabase status

2. Lire les valeurs locales Supabase avec supabase status, puis les exporter :

   export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   export NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon key locale>'
   export SUPABASE_SERVICE_ROLE_KEY='<service_role locale>'

   Le test refuse toute URL autre que localhost. Les clés restent dans l'environnement
   local : ne jamais la committer ni les utiliser dans le navigateur.

3. Lancer le test :

   npm run test:magnibox:integration

Le test crée des données synthétiques isolées dans Supabase local, dépose quatre objets
dans le bucket privé, démarre ClamAV et exécute plusieurs workers.

Scénarios vérifiés :

- PDF synthétique sain : available, objet conservé.
- Signature de test EICAR : rejected, objet supprimé.
- Binaire non pris en charge : rejected, objet supprimé.
- Empreinte SHA-256 incorrecte : reste quarantined, jamais publié.
- Workers concurrents : au plus une tentative par fixture et lease libérée.

Les fixtures sont nettoyées à la fin. Aucun transport SMTP, DNS ou MX n'est utilisé.

## Diagnostic manuel

Pour inspecter les services sans lancer le scénario automatisé :

   cp infra/magnibox-mail/.env.local-dev.example infra/magnibox-mail/.env.local-dev
   docker compose -f infra/magnibox-mail/compose.local.yaml up --build -d
   docker compose -f infra/magnibox-mail/compose.local.yaml logs -f attachment-worker

Le worker joint Supabase local via host.docker.internal:54321 et ClamAV via le réseau
Compose privé. Le port 3310 de ClamAV n'est pas publié sur l'hôte.

## Arrêt et limites

   docker compose -f infra/magnibox-mail/compose.local.yaml down
   supabase stop

Ce parcours valide worker + Storage local + ClamAV, mais pas la réception SMTP publique.
Les tests de panne ClamAV, de reprise d'un lease périmé et d'isolation RLS multi-organisation
restent distincts et sont requis avant la clôture complète de la campagne.
Ne jamais connecter ce worker de test à un projet Supabase de production.
