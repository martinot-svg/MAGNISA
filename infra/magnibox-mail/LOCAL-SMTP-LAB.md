# MAGNIBOX — laboratoire SMTP local sans livraison publique

## Objectif

Tester le vrai chemin **application → Postfix → relais SMTP → capture** sans VPS, DNS public, IP publique, fournisseur SMTP ou envoi vers de vraies boîtes.

Le laboratoire combine le MTA Docker Mailserver existant avec Mailpit. Postfix utilise Mailpit comme relais sortant par défaut. Mailpit capture les messages et les affiche dans une boîte de réception locale ; il ne les transmet pas sur Internet.

Ce mode permet de tester le protocole SMTP et le chemin Postfix. Il ne prouve pas la délivrabilité Internet.

## Prérequis

- Docker Engine et le plugin Docker Compose.
- Les fichiers de configuration locaux du MTA : `.env` et `mailserver.env`, préparés selon le README du dossier.
- Un certificat local de test pour le nom d'hôte du MTA, selon la configuration du Compose de base.
- Aucun serveur externe n'est requis.

Les secrets restent sur la machine de développement. Ne les commitez pas et ne les partagez pas dans une issue.

## Démarrage

Depuis la racine du dépôt :

```sh
docker compose \
  -f infra/magnibox-mail/compose.yaml \
  -f infra/magnibox-mail/compose.mailpit-relay.yaml \
  up -d --build
```

Vérifier les services :

```sh
docker compose \
  -f infra/magnibox-mail/compose.yaml \
  -f infra/magnibox-mail/compose.mailpit-relay.yaml \
  ps
```

Ouvrir la boîte de capture : http://127.0.0.1:8025

Le port SMTP Mailpit publié sur l'hôte est `127.0.0.1:1025`. Postfix ne l'utilise pas via ce port publié : les deux conteneurs communiquent par le réseau Docker partagé, avec le nom de service `mailpit`.

## Ce que fait l'overlay

- Définit `DEFAULT_RELAY_HOST=[mailpit]:1025` dans le conteneur Postfix.
- Ajoute Mailpit au même projet Compose.
- Lie l'interface web et le port SMTP de Mailpit exclusivement à `127.0.0.1`.
- Ne modifie aucun MX, SPF, DKIM, DMARC, PTR ou DNS.
- N'ouvre aucun port public.
- Ne configure aucun relais SMTP externe.

**Important :** l'overlay remplace la destination SMTP sortante de Postfix pour ce laboratoire. Ne le combinez pas avec un déploiement de production et ne réutilisez pas les paramètres de ce laboratoire sur un hôte public.

## Parcours de validation recommandé

1. Démarrer le MTA et Mailpit avec les deux fichiers Compose.
2. Vérifier que les conteneurs sont sains et que Postfix est démarré.
3. Envoyer un message de test depuis l'application MAGNIBOX en utilisant le compte SMTP de test local.
4. Utiliser un destinataire de test sous un domaine réservé, par exemple `recipient@example.invalid`.
5. Vérifier que le message apparaît dans Mailpit sur http://127.0.0.1:8025.
6. Vérifier les journaux Postfix et les événements MAGNIBOX : accepté par Postfix, remis au relais Mailpit, puis capturé.
7. Répéter avec les scénarios d'échec applicatifs et les tests de pièces jointes déjà couverts par le harnais local.

Le résultat attendu est une capture locale. N'utilisez pas d'adresse réelle comme destinataire de test.

## Contrôle IMAPS / Dovecot en CI

Le workflow `.github/workflows/magnibox-local-smtp-e2e.yml` active IMAP uniquement dans son environnement CI isolé et conserve le port 993 lié à loopback. Après le démarrage du MTA, le script `scripts/ci/test-magnibox-dovecot-imaps.py` : 
Le même workflow provisionne aussi quatre comptes jetables dans le domaine réservé `example.test`, répartis en deux groupes de test (organisation A et organisation B). Le script `scripts/ci/test-magnibox-dovecot-multitenant.py` vérifie pour chaque compte :

- authentification TLS et accès à sa propre INBOX ;
- APPEND d'un message synthétique avec un marqueur unique ;
- lecture de UIDVALIDITY, recherche du marqueur et récupération par UID ;
- reconnexion après APPEND pour simuler le redémarrage d'un worker après acceptation du message ;
- présence d'un seul marqueur après reconnexion, sans second APPEND ;
- absence de visibilité des marqueurs des trois autres boîtes.

Les quatre comptes sont générés à chaque exécution, leurs mots de passe sont aléatoires et masqués dans les logs, puis les données du conteneur sont supprimées en fin de job. Le test ne contacte aucun compte réel et n'ouvre pas le port 993 publiquement.

**Limite importante :** ce scénario exerce un vrai serveur Dovecot avec quatre boîtes isolées. Il ne lance pas encore `run-imap-sync.ts` contre un Supabase local peuplé de deux organisations. Le worker, ses RPC Supabase, son coffre de credentials et ses mappings UID sont couverts séparément par les tests unitaires/contractuels. La prochaine étape d'intégration est de démarrer Supabase local dans le même job, d'y créer les deux organisations et les quatre boîtes canoniques, puis de faire traiter les événements par le worker réel.


- vérifie la chaîne TLS et le nom d'hôte du certificat ;
- ouvre une session IMAPS avec le compte de test pré-provisionné ;
- liste les boîtes et sélectionne INBOX ;
- ajoute un message synthétique avec IMAP APPEND ;
- retrouve le message avec SEARCH et vérifie son contenu avec FETCH.

Ce test valide Dovecot et le stockage IMAP du laboratoire. Il ne prouve pas que les messages reçus par la passerelle MAGNIBOX sont synchronisés dans le Maildir Dovecot : l'inbox applicative MAGNIBOX reste stockée dans Supabase. Aucun port IMAPS public n'est activé.

## Limites et preuves

Ce laboratoire valide :
- la connexion SMTP locale de l'application à Postfix ;
- la mise en file et la remise SMTP de Postfix vers un relais ;
- l'observation des messages capturés et des journaux locaux.

Il ne valide pas :
- l'envoi ou la réception depuis Internet ;
- la réputation IP, les politiques anti-spam des fournisseurs ou les taux de livraison ;
- les enregistrements DNS publics, SPF, DKIM, DMARC ou PTR ;
- les retours de livraison réellement émis par Gmail, Outlook ou d'autres fournisseurs.

Pour la livraison Internet, un hôte public ou un relais externe peut être envisagé plus tard comme **adaptateur optionnel**, sans être une dépendance du développement ni de la validation locale.

## Arrêt

```sh
docker compose \
  -f infra/magnibox-mail/compose.yaml \
  -f infra/magnibox-mail/compose.mailpit-relay.yaml \
  down
```

Ne supprimez pas les volumes de données du MTA sans vérifier qu'ils ne contiennent aucune donnée à conserver.
