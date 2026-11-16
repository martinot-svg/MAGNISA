#!/usr/bin/env bash
set -euo pipefail

# Run from a network independent of the MTA host. This is a read-only probe:
# it never changes DNS, firewall rules, containers, queues, or mail activation.
HOST="${MAGNIBOX_MTA_HOSTNAME:-}"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

[[ -n "$HOST" ]] || fail "MAGNIBOX_MTA_HOSTNAME is required (for example mail.example.net)."
[[ "$HOST" != *example.net* && "$HOST" == *.* ]] || fail "Set a real MTA hostname; example values are not accepted."
command -v nc >/dev/null 2>&1 || fail "nc is required (install netcat)."
command -v openssl >/dev/null 2>&1 || fail "openssl is required."
command -v timeout >/dev/null 2>&1 || fail "timeout is required."

for port in 25 587 993; do
  nc -z -w 8 "$HOST" "$port" >/dev/null 2>&1 || fail "Inbound TCP/$port is not reachable on $HOST from this external network."
  pass "TCP/$port reachable on $HOST."
done

for port in 25 587; do
  timeout 12 openssl s_client \
    -connect "$HOST:$port" \
    -starttls smtp \
    -servername "$HOST" \
    -verify_hostname "$HOST" \
    -verify_return_error \
    -brief </dev/null >/dev/null 2>&1 || fail "TLS/STARTTLS verification failed on $HOST:$port (chain, expiry, or hostname)."
  pass "Verified SMTP STARTTLS certificate on $HOST:$port."
done

timeout 12 openssl s_client \
  -connect "$HOST:993" \
  -servername "$HOST" \
  -verify_hostname "$HOST" \
  -verify_return_error \
  -brief </dev/null >/dev/null 2>&1 || fail "IMAPS TLS verification failed on $HOST:993 (chain, expiry, or hostname)."
pass "Verified IMAPS TLS certificate on $HOST:993."

printf '\nMANUAL CHECKS STILL REQUIRED:\n'
printf '%s\n' "- Confirm TCP/25 is permitted in both directions with the hosting provider."
printf '%s\n' "- Verify A/PTR agreement, SPF, DKIM, DMARC, abuse controls, backups and monitoring."
printf '%s\n' "- Run the separate host-side preflight: infra/magnibox-mail/scripts/check-host-readiness.sh."
printf '%s\n' "- Do not enable MAGNIBOX_EXTERNAL_MAIL_ENABLED or change customer MX records from this probe."
