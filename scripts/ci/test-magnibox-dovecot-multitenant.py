#!/usr/bin/env python3
"""Multi-tenant Dovecot IMAPS isolation, UID and marker-replay smoke test."""
from __future__ import annotations

import imaplib
import os
import re
import ssl
import sys
import time
import uuid


def connect(host: str, port: int, username: str, password: str, context: ssl.SSLContext):
    client = imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=8)
    status, _ = client.login(username, password)
    if status != "OK":
        raise RuntimeError(f"IMAPS login failed for isolated test mailbox {username}")
    return client


def uidvalidity(client: imaplib.IMAP4_SSL) -> str:
    response = client.response("UIDVALIDITY")
    if not response or not response[1]:
        raise RuntimeError("Dovecot did not return UIDVALIDITY after SELECT")
    value = response[1][0].decode() if isinstance(response[1][0], bytes) else str(response[1][0])
    if not value.isdigit() or int(value) <= 0:
        raise RuntimeError("Dovecot returned an invalid UIDVALIDITY")
    return value


def find_marker(client: imaplib.IMAP4_SSL, marker: str) -> list[str]:
    status, data = client.uid("SEARCH", None, "HEADER", "X-Magnibox-Lab-ID", f'"{marker}"')
    if status != "OK":
        raise RuntimeError("Dovecot UID SEARCH failed")
    raw = data[0].decode() if data and data[0] else ""
    return [value for value in raw.split() if value.isdigit()]


def main() -> int:
    host = os.environ.get("MAGNIBOX_IMAP_HOST", "mail.example.test")
    port = int(os.environ.get("MAGNIBOX_IMAP_PORT", "993"))
    ca_file = os.environ["MAGNIBOX_IMAP_CA_FILE"]
    context = ssl.create_default_context(cafile=ca_file)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED

    mailboxes = [
        ("org-a-alice@example-a.test", os.environ["MAGNIBOX_LAB_ORG_A_ALICE_PASSWORD"]),
        ("org-a-bob@example-a.test", os.environ["MAGNIBOX_LAB_ORG_A_BOB_PASSWORD"]),
        ("org-b-alice@example-b.test", os.environ["MAGNIBOX_LAB_ORG_B_ALICE_PASSWORD"]),
        ("org-b-bob@example-b.test", os.environ["MAGNIBOX_LAB_ORG_B_BOB_PASSWORD"]),
    ]
    markers = {username: f"magnibox-lab-{uuid.uuid4()}" for username, _ in mailboxes}
    epochs: dict[str, str] = {}
    uids: dict[str, str] = {}

    for username, password in mailboxes:
        client = connect(host, port, username, password, context)
        try:
            status, _ = client.select("INBOX")
            if status != "OK":
                raise RuntimeError(f"Cannot select INBOX for {username}")
            epochs[username] = uidvalidity(client)
            marker = markers[username]
            raw = (
                f"From: lab@invalid.example\r\n"
                f"To: {username}\r\n"
                f"Subject: MAGNIBOX isolated tenant test\r\n"
                f"X-Magnibox-Lab-ID: {marker}\r\n"
                "MIME-Version: 1.0\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n\r\n"
                f"synthetic test data for {username}\r\n"
            ).encode()
            status, response = client.append("INBOX", None, imaplib.Time2Internaldate(time.time()), raw)
            if status != "OK":
                raise RuntimeError(f"APPEND failed for {username}")
            found = find_marker(client, marker)
            if len(found) != 1:
                raise RuntimeError(f"Expected exactly one APPEND marker for {username}, found {len(found)}")
            uids[username] = found[0]
            status, fetched = client.uid("FETCH", found[0], "(UID RFC822)")
            if status != "OK" or not fetched or marker.encode() not in fetched[0][1]:
                raise RuntimeError(f"UID FETCH did not return the expected message for {username}")
        finally:
            client.logout()

    # A fresh authenticated session simulates worker restart after APPEND was
    # accepted but before its result was persisted. The durable marker is found
    # and reused; the test deliberately does not issue a second APPEND.
    for username, password in mailboxes:
        client = connect(host, port, username, password, context)
        try:
            status, _ = client.select("INBOX")
            if status != "OK" or uidvalidity(client) != epochs[username]:
                raise RuntimeError(f"UIDVALIDITY changed unexpectedly for {username}")
            matches = find_marker(client, markers[username])
            if matches != [uids[username]]:
                raise RuntimeError(f"Restart recovery found duplicate or missing marker for {username}")
            for other_user, _ in mailboxes:
                if other_user == username:
                    continue
                if find_marker(client, markers[other_user]):
                    raise RuntimeError(f"Cross-mailbox message visibility detected for {username}")
        finally:
            client.logout()

    print("PASS Dovecot multi-mailbox lab: 2 organizations, 4 isolated mailboxes, TLS, UIDVALIDITY, UID FETCH, marker replay and cross-mailbox isolation.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL Dovecot multi-mailbox lab: {error}", file=sys.stderr)
        raise
