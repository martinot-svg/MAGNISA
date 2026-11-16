#!/usr/bin/env bash
set -euo pipefail

# Read-only host/network preflight. This script never starts containers,
# changes DNS, opens firewall ports, or enables external mail.
HOST="${MAGNIBOX_MTA_HOSTNAME:-}"
PROBE_DOMAIN="${MAGNIBOX_SMTP_PROBE_DOMAIN:-gmail.com}"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

[[ -n "$HOST" ]] || fail "MAGNIBOX_MTA_HOSTNAME is required (for example mail.example.net)."
[[ "$HOST" != *example.net* && "$HOST" == *.* ]] || fail "Set a real fully-qualified MTA hostname; example values are not accepted."
command -v dig >/dev/null 2>&1 || fail "dig is required (install dnsutils/bind-tools)."
command -v nc >/dev/null 2>&1 || fail "nc is required (install netcat)."
command -v python3 >/dev/null 2>&1 || fail "python3 is required."

mapfile -t IPV4S < <(dig +short A "$HOST" | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u)
(("${#IPV4S[@]}" > 0)) || fail "No public IPv4 A record found for $HOST."
for ip in "${IPV4S[@]}"; do
  python3 - "$ip" <<'PY' || fail "A record $ip is not a globally routable IPv4 address."
import ipaddress, sys
address = ipaddress.ip_address(sys.argv[1])
raise SystemExit(0 if address.version == 4 and address.is_global else 1)
PY
  PTR="$(dig +short -x "$ip" | sed 's/\.$//' | head -n 1)"
  [[ "$PTR" == "$HOST" ]] || fail "Reverse DNS for $ip is '$PTR', expected '$HOST'."
done
pass "A and PTR records agree for $HOST (${IPV4S[*]})."

MX="$(dig +short MX "$PROBE_DOMAIN" | sort -n | awk 'NR == 1 {print $2}' | sed 's/\.$//')"
[[ -n "$MX" ]] || fail "Could not resolve an MX host for probe domain $PROBE_DOMAIN."
nc -z -w 8 "$MX" 25 || fail "Outbound TCP/25 cannot reach $MX. Ask the hosting provider to remove the SMTP restriction."
pass "Outbound TCP/25 reached $MX."

printf '\nMANUAL EXTERNAL CHECK REQUIRED:\n'
printf '%s\n' "- From a machine outside this server/network, verify inbound TCP/25 reaches $HOST."
printf '%s\n' "- Obtain written provider confirmation that TCP/25 is permitted in both directions."
printf '%s\n' "- Verify firewall policy, TLS certificate, backups, abuse handling and monitoring."
printf '%s\n' "- Do not enable MAGNIBOX_EXTERNAL_MAIL_ENABLED until the full end-to-end checklist passes."
