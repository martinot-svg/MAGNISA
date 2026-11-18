#!/usr/bin/env python3
"""Exercise real Dovecot IMAPS authentication, APPEND, SEARCH and FETCH in CI."""
from __future__ import annotations

import imaplib
import os
import ssl
import sys
import time
import uuid


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def main() -> int:
    host = required("MAGNIBOX_IMAP_HOST")
    port = int(os.environ.get("MAGNIBOX_IMAP_PORT", "993"))
    username = required("MAGNIBOX_IMAP_USER")
    password = required("MAGNIBOX_IMAP_PASSWORD")
    ca_file = required("MAGNIBOX_IMAP_CA_FILE")

    context = ssl.create_default_context(cafile=ca_file)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED

    client = None
    for attempt in range(30):
        try:
            client = imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=5)
            break
        except (OSError, ssl.SSLError):
            if attempt == 29:
                raise
            time.sleep(2)
    if client is None:
        raise RuntimeError("Dovecot IMAPS did not become ready")

    try:
        typ, _ = client.login(username, password)
        if typ != "OK":
            raise RuntimeError("Dovecot rejected the isolated CI mailbox login")

        typ, boxes = client.list()
        if typ != "OK" or not boxes:
            raise RuntimeError("Dovecot did not return the mailbox list")

        typ, _ = client.select("INBOX")
        if typ != "OK":
            raise RuntimeError("Dovecot could not select INBOX")

        token = str(uuid.uuid4())
        subject = f"MAGNIBOX Dovecot IMAPS E2E {token}"
        raw = (
            f"From: magnibox-ci@example.test\r\n"
            f"To: {username}\r\n"
            f"Subject: {subject}\r\n"
            "MIME-Version: 1.0\r\n"
            "Content-Type: text/plain; charset=utf-8\r\n"
            "\r\n"
            f"IMAPS mailbox round-trip {token}\r\n"
        ).encode("utf-8")

        typ, _ = client.append("INBOX", None, imaplib.Time2Internaldate(time.time()), raw)
        if typ != "OK":
            raise RuntimeError("Dovecot APPEND did not persist the test message")

        typ, data = client.search(None, "HEADER", "Subject", f'"{subject}"')
        if typ != "OK" or not data or not data[0]:
            raise RuntimeError("Dovecot SEARCH could not find the persisted test message")

        message_id = data[0].split()[-1]
        typ, fetched = client.fetch(message_id, "(RFC822)")
        if typ != "OK" or not fetched or not fetched[0] or subject.encode() not in fetched[0][1]:
            raise RuntimeError("Dovecot FETCH did not return the persisted test message")

        print("PASS Dovecot IMAPS: verified TLS, authenticated login, mailbox listing, APPEND, SEARCH and FETCH.")
        return 0
    finally:
        try:
            client.logout()
        except (OSError, imaplib.IMAP4.error):
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL Dovecot IMAPS: {error}", file=sys.stderr)
        raise
