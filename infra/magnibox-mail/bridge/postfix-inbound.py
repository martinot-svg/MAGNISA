#!/usr/bin/env python3
"""Postfix pipe transport: forward one filtered envelope recipient to MAGNIBOX."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import urlparse

MAX_MESSAGE_BYTES = 25 * 1024 * 1024
# Must match orbit_external_messages.body_text database constraint.
MAX_TEXT_CHARS = 50_000
MAX_ATTACHMENT_COUNT = 5
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024
MAX_JSON_BYTES = 28 * 1024 * 1024
EMAIL_RE = re.compile(r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")


class StripHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def text(self):
        return " ".join(" ".join(self.parts).split())


def normalized_address(value: str) -> str:
    address = parseaddr(value)[1].strip().lower()
    if len(address) > 254 or not EMAIL_RE.fullmatch(address):
        raise ValueError("invalid address")
    return address


def safe_display_name(value: str) -> str:
    # A display label only; never use sender-controlled names as storage paths.
    name = value.replace("\r", " ").replace("\n", " ").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return (name if name not in ("", ".", "..") else "piece-jointe.bin")[:180]


def extract_content(message):
    plain = []
    html = []
    attachments = []
    total_bytes = 0
    for part in message.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        disposition = part.get_content_disposition()
        if disposition == "attachment" or filename:
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or not payload:
                raise ValueError("empty or invalid attachment")
            if len(payload) > MAX_ATTACHMENT_BYTES:
                raise ValueError("attachment too large")
            total_bytes += len(payload)
            if len(attachments) >= MAX_ATTACHMENT_COUNT or total_bytes > MAX_TOTAL_ATTACHMENT_BYTES:
                raise ValueError("attachment limits exceeded")
            attachments.append({
                "fileName": safe_display_name(str(filename or "piece-jointe.bin")),
                "contentType": part.get_content_type().lower()[:120],
                "contentBase64": base64.b64encode(payload).decode("ascii"),
            })
            continue
        content_type = part.get_content_type().lower()
        if content_type == "text/plain":
            plain.append(str(part.get_content()))
        elif content_type == "text/html":
            parser = StripHTML()
            parser.feed(str(part.get_content()))
            html.append(parser.text())
        else:
            # Never acknowledge a message after silently discarding an unhandled
            # MIME payload (including inline binary parts without a filename).
            raise ValueError("unsupported MIME part in the current inbox contract")
    text = "\n".join(plain).strip() or "\n".join(html).strip()
    if not text or len(text) > MAX_TEXT_CHARS:
        raise ValueError("empty or oversized message body")
    return text, attachments


def extract_text(message) -> str:
    # Compatibility wrapper retained for existing contract tests.
    text, attachments = extract_content(message)
    if attachments:
        raise ValueError("attachments are not supported by the current inbox contract")
    return text


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def forward(raw: bytes, recipient: str) -> int:
    if not raw or len(raw) > MAX_MESSAGE_BYTES:
        return 69
    endpoint = os.environ.get("MAGNIBOX_INBOUND_URL", "").strip()
    secret = os.environ.get("MAGNIBOX_INBOUND_WEBHOOK_SECRET", "")
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return 75
    if len(secret) < 32:
        return 75

    try:
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        sender = normalized_address(str(msg.get("From", "")))
        to = normalized_address(recipient)
        subject = str(msg.get("Subject", "")).replace("\r", " ").replace("\n", " ").strip()
        if not subject:
            subject = "(sans objet)"
        if len(subject) > 180:
            subject = subject[:180]
        body, attachments = extract_content(msg)
        original_id = str(msg.get("Message-ID", "")).strip()
        safe_id = re.sub(r"[^A-Za-z0-9._:@+-]", "", original_id.strip("<>"))[:160]
        if not safe_id:
            safe_id = "sha256-" + hashlib.sha256(raw + to.encode()).hexdigest()
        payload = {
            "messageId": safe_id,
            "from": sender,
            "to": [to],
            "subject": subject,
            "text": body,
            "attachments": attachments,
        }
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_JSON_BYTES:
            return 69
        timestamp = str(int(time.time()))
        signature = hmac.new(secret.encode(), timestamp.encode() + b"." + encoded, hashlib.sha256).hexdigest()
        request = urllib.request.Request(
            endpoint,
            data=encoded,
            headers={
                "Content-Type": "application/json",
                "x-magnibox-timestamp": timestamp,
                "x-magnibox-signature": "sha256=" + signature,
            },
            method="POST",
        )
        opener = urllib.request.build_opener(NoRedirect)
        with opener.open(request, timeout=10) as response:
            return 0 if response.status == 202 else (75 if response.status >= 500 else 69)
    except urllib.error.HTTPError as error:
        if error.code in (300, 301, 302, 303, 307, 308, 401, 403, 404, 408, 425, 429) or error.code >= 500:
            return 75
        return 69
    except (urllib.error.URLError, TimeoutError, OSError):
        return 75
    except (ValueError, TypeError):
        return 69


def main() -> int:
    if len(sys.argv) != 3:
        return 64
    raw = sys.stdin.buffer.read(MAX_MESSAGE_BYTES + 1)
    return forward(raw, sys.argv[2])


if __name__ == "__main__":
    raise SystemExit(main())
