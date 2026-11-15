import hashlib, hmac, importlib.util, json, unittest
from pathlib import Path
from unittest.mock import patch
MODULE=Path(__file__).with_name("postfix-delivery-events.py")
spec=importlib.util.spec_from_file_location("postfix_delivery_events",MODULE)
forwarder=importlib.util.module_from_spec(spec); spec.loader.exec_module(forwarder)

class PostfixDeliveryEventTests(unittest.TestCase):
    def test_parses_sent_as_remote_mta_acceptance(self):
        line="Nov 15 10:20:30 mx postfix/smtp[123]: ABC123DEF: to=<client@example.net>, relay=mx.example.net[192.0.2.1]:25, delay=1, dsn=2.0.0, status=sent (250 queued)"
        self.assertEqual(forwarder.parse_log_line(line),{"queueId":"ABC123DEF","event":"delivered"})
    def test_maps_bounce_defer_and_expiry(self):
        base="postfix/smtp[123]: 1A2B3C4D: to=<x@example.net>, relay=mx, status={status} (diagnostic)"
        self.assertEqual(forwarder.parse_log_line(base.format(status="bounced"))["event"],"bounced")
        self.assertEqual(forwarder.parse_log_line(base.format(status="deferred"))["event"],"deferred")
        self.assertEqual(forwarder.parse_log_line(base.format(status="expired"))["event"],"failed")
    def test_ignores_non_smtp_and_unrelated_lines(self):
        self.assertIsNone(forwarder.parse_log_line("postfix/qmgr[12]: ABC123: removed"))
        self.assertIsNone(forwarder.parse_log_line("postfix/smtp[12]: connect to mx:25: timed out"))
    def test_event_signature_matches_application_contract(self):
        payload={"queueId":"ABC123DEF","event":"delivered"}
        encoded=json.dumps(payload,separators=(",",":"),ensure_ascii=True).encode("ascii")
        with patch.object(forwarder.time,"time",return_value=1800000000):
            with patch.object(forwarder.urllib.request,"build_opener") as build:
                build.return_value.open.return_value.__enter__.return_value.status=202
                self.assertTrue(forwarder.send_event(payload,"https://magnisa.example/api/internal/magnibox/delivery-event","s"*40))
                request=build.return_value.open.call_args.args[0]
                expected=hmac.new(b"s"*40,request.headers["X-magnibox-timestamp"].encode()+b"."+encoded,hashlib.sha256).hexdigest()
                self.assertEqual(request.headers["X-magnibox-signature"],"sha256="+expected)
    def test_cursor_round_trip_and_rotation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            cursor=Path(directory)/"cursor.json"; forwarder.save_cursor(cursor,1234,56)
            self.assertEqual(forwarder.load_cursor(cursor,1234,100),56)
            self.assertEqual(forwarder.load_cursor(cursor,5678,100),0)

if __name__=="__main__": unittest.main()
