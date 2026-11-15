import importlib.util
import unittest
from email import policy
from email.parser import BytesParser
from pathlib import Path

MODULE = Path(__file__).with_name("postfix-inbound.py")
spec = importlib.util.spec_from_file_location("postfix_inbound", MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class InboundBridgeTests(unittest.TestCase):
    def test_normalizes_envelope_recipient(self):
        self.assertEqual(bridge.normalized_address("Finance@Example.org"), "finance@example.org")

    def test_rejects_header_injection_address(self):
        with self.assertRaises(ValueError):
            bridge.normalized_address("victim@example.org\r\nBcc: other@example.org")

    def test_extracts_plain_text(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            b"From: sender@example.org\r\nSubject: Hello\r\n"
            b"Content-Type: text/plain; charset=utf-8\r\n\r\nBonjour"
        )
        self.assertEqual(bridge.extract_text(msg), "Bonjour")

    def test_rejects_attachment_instead_of_silently_dropping_it(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            b"From: sender@example.org\r\nSubject: Hello\r\n"
            b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n"
            b"--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n"
            b"--x\r\nContent-Type: application/pdf\r\n"
            b'Content-Disposition: attachment; filename="../invoice.pdf"\r\n'
        )
        with self.assertRaises(ValueError):
            bridge.extract_text(msg)


    def test_rejects_inline_binary_part_without_filename(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            b"From: sender@example.org\r\nSubject: Hello\r\n"
            b"MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=x\r\n\r\n"
            b"--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody\r\n"
            b"--x\r\nContent-Type: application/octet-stream\r\n"
            b"Content-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            b"AAECAwQ=\r\n--x--"
        )
        with self.assertRaisesRegex(ValueError, "unsupported MIME part"):
            bridge.extract_text(msg)

    def test_rejects_unknown_text_subtype(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            b"From: sender@example.org\r\nSubject: Hello\r\n"
            b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n"
            b"--x\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR\r\n--x--"
        )
        with self.assertRaisesRegex(ValueError, "unsupported MIME part"):
            bridge.extract_text(msg)

    def test_rejects_oversized_body_at_database_limit(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            ("From: sender@example.org\r\nSubject: Hello\r\n"
             "Content-Type: text/plain; charset=utf-8\r\n\r\n" + "x" * (bridge.MAX_TEXT_CHARS + 1)).encode()
        )
        with self.assertRaises(ValueError):
            bridge.extract_text(msg)

    def test_accepts_body_at_exact_database_limit(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            ("From: sender@example.org\r\nSubject: Hello\r\n"
             "Content-Type: text/plain; charset=utf-8\r\n\r\n" + "x" * bridge.MAX_TEXT_CHARS).encode()
        )
        self.assertEqual(len(bridge.extract_text(msg)), bridge.MAX_TEXT_CHARS)

    def test_rejects_non_https_endpoint(self):
        import os
        previous = dict(os.environ)
        try:
            os.environ["MAGNIBOX_INBOUND_URL"] = "http://example.org/hook"
            os.environ["MAGNIBOX_INBOUND_WEBHOOK_SECRET"] = "x" * 40
            self.assertEqual(bridge.forward(b"From: a@example.org\n\nhello", "b@example.org"), 75)
        finally:
            os.environ.clear()
            os.environ.update(previous)


    def test_extracts_attachment_as_bounded_base64_payload(self):
        msg = BytesParser(policy=policy.default).parsebytes(
            b"From: sender@example.org\r\nSubject: Hello\r\n"
            b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n"
            b"--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n"
            b"--x\r\nContent-Type: application/pdf\r\n"
            b'Content-Disposition: attachment; filename="../invoice.pdf"\r\n'
            b"Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n--x--"
        )
        text, attachments = bridge.extract_content(msg)
        self.assertEqual(text, "Body")
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["fileName"], "invoice.pdf")
        self.assertEqual(attachments[0]["contentType"], "application/pdf")
        self.assertEqual(attachments[0]["contentBase64"], "JVBERi0xLjQ=")

    def test_rejects_more_than_five_attachments(self):
        boundary = "x"
        parts = []
        for index in range(6):
            parts.append(
                f"--{boundary}\r\nContent-Type: application/octet-stream\r\n"
                f"Content-Disposition: attachment; filename=f{index}.bin\r\n"
                f"Content-Transfer-Encoding: base64\r\n\r\nQQ==\r\n"
            )
        raw = (
            "From: sender@example.org\r\nSubject: Hello\r\nMIME-Version: 1.0\r\n"
            f"Content-Type: multipart/mixed; boundary={boundary}\r\n\r\n"
            + "".join(parts) + f"--{boundary}--"
        ).encode()
        msg = BytesParser(policy=policy.default).parsebytes(raw)
        with self.assertRaisesRegex(ValueError, "attachment limits"):
            bridge.extract_content(msg)


if __name__ == "__main__":
    unittest.main()
