import test from "node:test";
import assert from "node:assert/strict";
import { assertMagniboxPostfixTransport } from "./magnibox-postfix-runtime-config.mjs";

test("rejects SMTP acceptance configuration that has no MAGNIBOX pipe transport", () => {
  assert.throws(
    () => assertMagniboxPostfixTransport("myhostname = mail.example.test", "smtp inet n - y - - smtpd"),
    /virtual_mailbox_domains/
  );
});

test("rejects a virtual transport name without a registered pipe service", () => {
  const main = [
    "virtual_mailbox_domains = hash:/tmp/docker-mailserver/magnibox-test-domains",
    "virtual_mailbox_maps = hash:/tmp/docker-mailserver/magnibox-test-recipients",
    "virtual_transport = magnibox-inbound",
  ].join("\\n");
  assert.throws(
    () => assertMagniboxPostfixTransport(main, "smtp inet n - y - - smtpd"),
    /master.cf has no magnibox-inbound pipe service/
  );
});

test("accepts only the active Postfix configuration that routes the recipient to the bridge", () => {
  const main = [
    "virtual_mailbox_domains = hash:/tmp/docker-mailserver/magnibox-test-domains",
    "virtual_mailbox_maps = hash:/tmp/docker-mailserver/magnibox-test-recipients",
    "virtual_transport = magnibox-inbound",
  ].join("\\n");
  const master = [
    "smtp inet n - y - - smtpd",
    "magnibox-inbound unix - n n - - pipe",
    "  flags=Rq user=nobody argv=/usr/bin/python3 /opt/magnibox-bridge/postfix-inbound.py ${sender} ${recipient}",
  ].join("\\n");
  assert.equal(assertMagniboxPostfixTransport(main, master), true);
});
