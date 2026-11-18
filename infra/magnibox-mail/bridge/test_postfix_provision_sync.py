import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
MODULE=Path(__file__).with_name("postfix-provision-sync.py")
spec=importlib.util.spec_from_file_location("postfix_provision_sync",MODULE)
sync=importlib.util.module_from_spec(spec); spec.loader.exec_module(sync)

def snapshot(domains,recipients):
    revision=hashlib.sha256(json.dumps({"domains":domains,"recipients":recipients},separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
    return {"generatedAt":"2026-11-15T00:00:00Z","domains":domains,"recipients":recipients,"revision":revision}

class ProvisioningSyncTests(unittest.TestCase):
    def test_rejects_recipient_outside_approved_domain(self):
        value=snapshot(["example.net"],["user@evil.net"])
        with self.assertRaises(ValueError): sync.validate_snapshot(value)
    def test_rejects_unsorted_or_duplicate_entries(self):
        value=snapshot(["z.example","a.example"],[])
        with self.assertRaises(ValueError): sync.validate_snapshot(value)
    def test_rejects_revision_tampering(self):
        value=snapshot(["example.net"],["info@example.net"]); value["revision"]="0"*64
        with self.assertRaises(ValueError): sync.validate_snapshot(value)
    def test_renders_postfix_maps(self):
        value=snapshot(["example.net"],["info@example.net"])
        domains,recipients=sync.render_maps(sync.validate_snapshot(value))
        self.assertEqual(domains,"example.net OK\n")
        self.assertEqual(recipients,"info@example.net magnibox/\n")
    def test_publishes_versioned_maps_and_atomically_updates_current_symlink(self):
        value=snapshot(["example.net"],["info@example.net"])
        with tempfile.TemporaryDirectory() as directory:
            def fake_postmap(command, **kwargs):
                Path(command[1].removeprefix("hash:") + ".db").write_bytes(b"indexed")
            with patch.object(sync.subprocess,"run",side_effect=fake_postmap) as postmap:
                generation=sync.publish_maps(value,Path(directory))
                # Replaying the exact same snapshot is idempotent and does not
                # regenerate or mutate the immutable revision directory.
                again=sync.publish_maps(value,Path(directory))
            self.assertEqual(generation.name,value["revision"])
            self.assertEqual(again,generation)
            self.assertTrue((Path(directory)/"current").is_symlink())
            self.assertEqual((Path(directory)/"current").resolve(),generation)
            self.assertEqual(postmap.call_count,2)
            self.assertTrue((generation/"domains.db").is_file())
            self.assertTrue((generation/"recipients.db").is_file())

    def test_refuses_partial_existing_generation(self):
        value=snapshot(["example.net"],["info@example.net"])
        with tempfile.TemporaryDirectory() as directory:
            generation=Path(directory)/value["revision"]
            generation.mkdir()
            (generation/"domains").write_text("example.net OK\\n")
            with self.assertRaisesRegex(ValueError,"incomplete"):
                sync.publish_maps(value,Path(directory))

    def test_refuses_postmap_success_without_index_files(self):
        value=snapshot(["example.net"],["info@example.net"])
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sync.subprocess,"run"):
                with self.assertRaisesRegex(ValueError,"did not produce"):
                    sync.publish_maps(value,Path(directory))
            self.assertFalse((Path(directory)/value["revision"]).exists())
    def test_hmac_response_verification(self):
        body=b'{"domains":[],"recipients":[],"revision":"' + b"a"*64 + b'"}'
        timestamp="1800000000"; secret="s"*40
        signature=sync.sign_request(body,timestamp,secret)
        self.assertTrue(sync.verify_response(body,timestamp,signature,secret,1800000000))
        self.assertFalse(sync.verify_response(body,timestamp,signature,secret,1800000400))

if __name__=="__main__": unittest.main()
