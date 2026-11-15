#!/usr/bin/env sh
set -eu

CONTAINER="\${MAGNIBOX_MAIL_CONTAINER:-magnibox-mailserver}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERREUR: docker est introuvable." >&2
  exit 2
fi

running="$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
if [ "$running" != "true" ]; then
  echo "ERREUR: le conteneur $CONTAINER n'est pas démarré." >&2
  exit 2
fi

clamav_enabled="$(docker exec "$CONTAINER" printenv ENABLE_CLAMAV 2>/dev/null || true)"
if [ "$clamav_enabled" != "1" ]; then
  echo "ERREUR: ENABLE_CLAMAV n'est pas égal à 1 dans le conteneur." >&2
  exit 2
fi

if ! docker exec "$CONTAINER" sh -ec '
  command -v clamdscan >/dev/null 2>&1
  clamdscan --no-summary /etc/hostname >/dev/null
'; then
  echo "ERREUR: clamdscan est absent ou le démon ClamAV ne répond pas." >&2
  exit 2
fi

echo "OK: ClamAV est activé et répond à un scan de contrôle."
echo "ATTENTION: ce contrôle ne prouve pas à lui seul que le chemin Postfix filtre chaque message."
echo "Ne pas activer les pièces jointes MAGNIBOX avant un test d'intégration de bout en bout."
