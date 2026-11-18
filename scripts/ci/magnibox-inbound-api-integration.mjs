import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { spawnSync, execFileSync } from "node:child_process";
import nodemailer from "nodemailer";
import { assertMagniboxPostfixTransport } from "./magnibox-postfix-runtime-config.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.MAGNIBOX_INBOUND_WEBHOOK_SECRET;
const base = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
if (!url || !anon || !service || !secret) throw new Error("Missing local Supabase or inbound test configuration.");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) {
  throw new Error("Safety stop: inbound integration only accepts localhost Supabase.");
}
if (secret.length < 32) throw new Error("Inbound test secret must contain at least 32 characters.");

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
const stamp = randomUUID().replaceAll("-", "").slice(0, 16);
const email = "magnibox-inbound-" + stamp + "@magnisa.test";
const password = "Inbound-" + randomBytes(24).toString("hex") + "!9";
const domain = process.env.MAGNIBOX_INBOUND_TEST_DOMAIN || ("inbound-" + stamp + ".example.org");
const recipient = "receiver@" + domain;
const messageId = "local-inbound-" + stamp;
const attachmentBytes = Buffer.from("MAGNIBOX LOCAL INBOUND QUARANTINE FIXTURE");
const attachment = {
  fileName: "inbound-fixture.txt",
  contentType: "text/plain",
  contentBase64: attachmentBytes.toString("base64"),
};
const created = { userId: null, unauthorizedUserId: null, organizationId: null, mailboxId: null, domainId: null, addressId: null, identityId: null, messageIds: [], storagePaths: [] };
function assert(condition, message) { if (!condition) throw new Error(message); }
function unwrap(result, label) {
  if (result.error || result.data == null) throw new Error(label + ": " + (result.error?.message ?? "no data"));
  return result.data;
}
function signedRequest(payload, signatureOverride) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signatureOverride ?? "sha256=" + createHmac("sha256", secret)
    .update(timestamp + "." + raw).digest("hex");
  return fetch(base + "/api/internal/magnibox/inbound", {
    method: "POST",
    headers: { "content-type": "application/json", "x-magnibox-timestamp": timestamp, "x-magnibox-signature": signature },
    body: raw,
  });
}
try {
  const user = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create inbound test user");
  created.userId = user.user.id;
  const owner = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await owner.auth.signInWithPassword({ email, password }), "sign in inbound test owner");
  const org = unwrap(await owner.rpc("create_organization", {
    p_name: "MAGNIBOX inbound E2E " + stamp, p_currency: "MGA",
  }), "create isolated inbound organization");
  created.organizationId = org;
  unwrap(await owner.from("mgmail_internal_namespaces").insert({
    organization_id: org, slug: "inbound-" + stamp,
  }).select("organization_id").single(), "create internal namespace");
  const mailbox = unwrap(await owner.from("mgmail_internal_mailboxes").insert({
    organization_id: org, local_part: "receiver", owner_user_id: user.user.id,
    display_name: "Inbound E2E receiver",
  }).select("id").single(), "create inbound mailbox");
  created.mailboxId = mailbox.id;
  const domainRow = unwrap(await owner.from("mgmail_domain_requests").insert({
    organization_id: org, domain_name: domain, requested_by: user.user.id,
  }).select("id").single(), "create test domain request");
  created.domainId = domainRow.id;
  const addressRow = unwrap(await owner.from("mgmail_public_address_requests").insert({
    organization_id: org, mailbox_id: mailbox.id, domain_request_id: domainRow.id,
    domain_name: domain, local_part: "receiver", requested_by: user.user.id,
  }).select("id").single(), "create test address request");
  created.addressId = addressRow.id;
  unwrap(await admin.from("mgmail_domain_requests").update({
    status: "verified", verified_at: new Date().toISOString(), proof_reference: "local-inbound-e2e-only",
  }).eq("id", domainRow.id).select("id").single(), "verify local test domain");
  unwrap(await admin.from("mgmail_public_address_requests").update({ status: "approved" })
    .eq("id", addressRow.id).select("id").single(), "approve local test address");
  const identity = unwrap(await admin.from("orbit_public_identities").insert({
    organization_id: org, domain_request_id: domainRow.id, address_request_id: addressRow.id,
    mailbox_id: mailbox.id, domain_name: domain, local_part: "receiver", provider: "smtp",
    provider_domain_ref: "local-inbound-e2e-no-provider", provider_verified_at: new Date().toISOString(),
    status: "active", receive_enabled: true,
  }).select("id").single(), "create local inbound identity");
  created.identityId = identity.id;
  console.log("Inbound E2E: synthetic organization, approved domain, mailbox and SMTP identity ready");

  const payload = {
    messageId, from: "sender@example.invalid", to: [recipient],
    subject: "MAGNIBOX inbound local E2E " + stamp,
    text: "Synthetic message accepted through the signed inbound API.",
    attachments: [attachment],
  };
  const accepted = await signedRequest(payload);
  const acceptedText = await accepted.text();
  assert(accepted.status === 202, "valid signed inbound message must be accepted; got HTTP " + accepted.status + " " + acceptedText);
  const acceptedBody = JSON.parse(acceptedText);
  assert(acceptedBody.ok === true && acceptedBody.accepted === 1 && acceptedBody.quarantinedAttachments === 1,
    "unexpected inbound acceptance response: " + JSON.stringify(acceptedBody));

  const stored = unwrap(await admin.from("orbit_external_messages")
    .select("id,from_email,to_emails,subject,body_text,provider_email_id")
    .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", messageId).single(),
    "read accepted inbound message");
  created.messageIds.push(stored.id);
  console.log("Inbound E2E: signed API accepted and persisted the primary message");
  assert(stored.from_email === payload.from && stored.to_emails?.[0] === recipient
    && stored.subject === payload.subject && stored.body_text === payload.text,
  "stored inbound envelope does not match the submitted message");

  const metadata = unwrap(await admin.from("orbit_external_message_attachments")
    .select("id,storage_path,display_name,byte_size,sha256,scan_status")
    .eq("message_id", stored.id).eq("organization_id", org).single(),
    "read quarantined attachment metadata");
  created.storagePaths.push(metadata.storage_path);
  assert(metadata.display_name === attachment.fileName && metadata.byte_size === attachmentBytes.length
    && metadata.sha256 === createHash("sha256").update(attachmentBytes).digest("hex")
    && metadata.scan_status === "quarantined",
  "inbound attachment must be stored with SHA-256 metadata in quarantine");
  const storedObject = await admin.storage.from("magnibox-attachments").download(metadata.storage_path);
  assert(!storedObject.error && storedObject.data, "quarantined attachment object must exist in private storage");

  // A separately authenticated user with no organization membership must not
  // be able to read the quarantined object from the private Storage bucket.
  const unauthorizedEmail = "magnibox-outsider-" + stamp + "@magnisa.test";
  const unauthorizedPassword = "Outsider-" + randomBytes(24).toString("hex") + "!9";
  const outsiderUser = unwrap(await admin.auth.admin.createUser({
    email: unauthorizedEmail, password: unauthorizedPassword, email_confirm: true,
  }), "create unauthorized attachment test user");
  created.unauthorizedUserId = outsiderUser.user.id;
  const outsider = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await outsider.auth.signInWithPassword({ email: unauthorizedEmail, password: unauthorizedPassword }),
    "sign in unauthorized attachment test user");
  const forbiddenDownload = await outsider.storage.from("magnibox-attachments").download(metadata.storage_path);
  assert(!!forbiddenDownload.error || !forbiddenDownload.data,
    "an authenticated user outside the organization must not download a quarantined attachment");
  console.log("Inbound E2E: authenticated non-member denied access to quarantined attachment");

  const replay = await signedRequest(payload);
  const replayText = await replay.text();
  assert(replay.status === 202, "identical retry must be idempotently accepted; got HTTP " + replay.status + " " + replayText);
  const replayCount = await admin.from("orbit_external_messages").select("id", { count: "exact", head: true })
    .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", messageId);
  if (replayCount.error) throw replayCount.error;
  assert(replayCount.count === 1, "duplicate retry must leave exactly one message row; got " + replayCount.count);
  console.log("Inbound E2E: identical replay is idempotent");

  const conflict = await signedRequest({ ...payload, text: payload.text + " altered" });
  assert(conflict.status === 409, "same provider message ID with different content must return 409; got " + conflict.status);
  const unknown = await signedRequest({ ...payload, messageId: messageId + "-unknown", to: ["nobody@" + domain] });
  assert(unknown.status === 422, "unprovisioned recipient must be rejected; got " + unknown.status);
  const invalidSignature = await signedRequest({ ...payload, messageId: messageId + "-bad-signature" }, "sha256=" + "0".repeat(64));
  assert(invalidSignature.status === 401, "invalid HMAC must be rejected; got " + invalidSignature.status);

  // Exercise the exact MIME parser and HMAC forwarder used by Postfix's pipe
  // transport. HTTP is permitted only for this explicit loopback CI test.
  const bridgeMessageId = "bridge-" + stamp + "@magnisa.test";
  const bridgeSubject = "MAGNIBOX inbound bridge E2E " + stamp;
  const boundary = "magnibox-" + stamp;
  const bridgeRaw = [
    "From: sender@example.invalid",
    "To: " + recipient,
    "Message-ID: <" + bridgeMessageId + ">",
    "Subject: " + bridgeSubject,
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Message passed through the Postfix inbound bridge parser.",
    "--" + boundary,
    'Content-Type: text/plain; name="bridge-fixture.txt"',
    'Content-Disposition: attachment; filename="bridge-fixture.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    attachment.contentBase64,
    "--" + boundary + "--",
    "",
  ].join("\r\n");
  const bridgeRun = spawnSync("python3", [
    "infra/magnibox-mail/bridge/postfix-inbound.py", "sender@example.invalid", recipient,
  ], {
    input: bridgeRaw,
    encoding: "utf8",
    env: {
      ...process.env,
      MAGNIBOX_INBOUND_URL: base + "/api/internal/magnibox/inbound",
      MAGNIBOX_INBOUND_WEBHOOK_SECRET: secret,
      MAGNIBOX_INBOUND_ALLOW_HTTP_LOCAL: "true",
    },
  });
  assert(bridgeRun.status === 0, "Postfix inbound bridge must POST the MIME envelope successfully; exit="
    + bridgeRun.status + " stderr=" + bridgeRun.stderr);
  console.log("Inbound E2E: MIME bridge successfully forwarded to the local API");
  const bridged = unwrap(await admin.from("orbit_external_messages")
    .select("id,subject,body_text,provider_email_id")
    .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", bridgeMessageId).single(),
    "read bridged MIME message");
  created.messageIds.push(bridged.id);
  assert(bridged.subject === bridgeSubject && bridged.body_text.includes("Postfix inbound bridge parser"),
    "bridge must preserve the MIME subject and text body");
  const bridgedAttachment = unwrap(await admin.from("orbit_external_message_attachments")
    .select("id,storage_path,scan_status,sha256")
    .eq("message_id", bridged.id).eq("organization_id", org).single(),
    "read bridge attachment quarantine");
  created.storagePaths.push(bridgedAttachment.storage_path);
  assert(bridgedAttachment.scan_status === "quarantined"
    && bridgedAttachment.sha256 === createHash("sha256").update(attachmentBytes).digest("hex"),
  "bridge attachment must be stored in quarantine with its content hash");

  // Drive the configured Postfix virtual transport over a real loopback SMTP
  // session. The maps are synthetic and only contain this test recipient.
  execFileSync("docker", ["exec", "magnibox-mailserver", "postmap", "/tmp/docker-mailserver/magnibox-test-domains"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postmap", "/tmp/docker-mailserver/magnibox-test-recipients"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-e",
    "virtual_mailbox_domains=hash:/tmp/docker-mailserver/magnibox-test-domains"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-e",
    "virtual_mailbox_maps=hash:/tmp/docker-mailserver/magnibox-test-recipients"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-e", "virtual_transport=magnibox-inbound"]);
  const inheritedEnvironment = execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-h", "export_environment"], { encoding: "utf8" })
    .trim().split(/\s+/).filter(Boolean);
  const bridgeEnvironment = ["MAGNIBOX_INBOUND_URL", "MAGNIBOX_INBOUND_WEBHOOK_SECRET", "MAGNIBOX_INBOUND_ALLOW_HTTP_LOCAL"];
  const exportedEnvironment = [...new Set([...inheritedEnvironment, ...bridgeEnvironment])].join(" ");
  execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-e", "export_environment=" + exportedEnvironment]);
  const installPipe = [
    "sed -i '/^magnibox-inbound[[:space:]]/,+1d' /etc/postfix/master.cf",
    "cat >> /etc/postfix/master.cf <<'MAGNIBOX_EOF'",
    "magnibox-inbound unix - n n - - pipe",
    "  flags=Rq user=nobody argv=/usr/bin/python3 /opt/magnibox-bridge/postfix-inbound.py ${sender} ${recipient}",
    "MAGNIBOX_EOF",
  ].join("\n");
  execFileSync("docker", ["exec", "magnibox-mailserver", "sh", "-ec", installPipe]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postfix", "reload"]);
  const activeMain = execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-n"], { encoding: "utf8" });
  const activeMaster = execFileSync("docker", ["exec", "magnibox-mailserver", "cat", "/etc/postfix/master.cf"], { encoding: "utf8" });
  assertMagniboxPostfixTransport(activeMain, activeMaster);
  console.log("Inbound E2E: active Postfix maps and magnibox-inbound pipe transport verified");
  const smtp = nodemailer.createTransport({
    host: "127.0.0.1", port: 25, secure: false, ignoreTLS: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  const postfixMessageId = "postfix-" + stamp + "@magnisa.test";
  const postfixSubject = "MAGNIBOX Postfix inbound E2E " + stamp;
  const postfixMail = {
    from: "sender@mail.example.test",
    to: recipient,
    subject: postfixSubject,
    text: "Message submitted over SMTP to local Postfix and delivered through its MAGNIBOX pipe transport.",
    messageId: "<" + postfixMessageId + ">",
    attachments: [{ filename: attachment.fileName, content: attachmentBytes, contentType: "text/plain" }],
  };
  await smtp.sendMail(postfixMail);
  console.log("Inbound E2E: Postfix accepted the SMTP transaction for " + recipient);
  let postfixMessage = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const lookup = await admin.from("orbit_external_messages")
      .select("id,subject,body_text,provider_email_id")
      .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", postfixMessageId).maybeSingle();
    if (lookup.error) throw lookup.error;
    if (lookup.data) { postfixMessage = lookup.data; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(postfixMessage, "Postfix accepted SMTP but the MAGNIBOX pipe bridge did not persist the message within 45 seconds");
  console.log("Inbound E2E: Postfix pipe delivery reached the MAGNIBOX database");
  created.messageIds.push(postfixMessage.id);
  assert(postfixMessage.subject === postfixSubject && postfixMessage.body_text.includes("submitted over SMTP"),
    "Postfix-to-MAGNIBOX delivery must preserve the SMTP subject and body");
  const postfixAttachment = unwrap(await admin.from("orbit_external_message_attachments")
    .select("storage_path,scan_status,sha256").eq("message_id", postfixMessage.id).eq("organization_id", org).single(),
    "read Postfix-delivered attachment metadata");
  created.storagePaths.push(postfixAttachment.storage_path);
  assert(postfixAttachment.scan_status === "quarantined"
    && postfixAttachment.sha256 === createHash("sha256").update(attachmentBytes).digest("hex"),
    "Postfix-delivered attachment must remain quarantined with a verified SHA-256 hash");

  // A second SMTP submission with the same Message-ID must not duplicate the
  // message or its quarantined attachment in MAGNIBOX.
  await smtp.sendMail(postfixMail);
  const duplicateMessageCount = await admin.from("orbit_external_messages")
    .select("id", { count: "exact", head: true })
    .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", postfixMessageId);
  if (duplicateMessageCount.error) throw duplicateMessageCount.error;
  assert(duplicateMessageCount.count === 1,
    "replayed Postfix SMTP Message-ID must leave exactly one MAGNIBOX message");
  const duplicateAttachmentCount = await admin.from("orbit_external_message_attachments")
    .select("id", { count: "exact", head: true }).eq("message_id", postfixMessage.id);
  if (duplicateAttachmentCount.error) throw duplicateAttachmentCount.error;
  assert(duplicateAttachmentCount.count === 1,
    "replayed Postfix SMTP delivery must not duplicate quarantined attachments");
  console.log("Inbound E2E: duplicate SMTP Message-ID is idempotent, with one quarantined attachment");

  // Reconfigure only the CI container for a deterministic one-shot EX_TEMPFAIL.
  // Postfix must retain the queued message; after recovery, a forced retry must
  // deliver it exactly once through the real bridge and then remove it from queue.
  const retryWrapper = [
    "#!/bin/sh",
    "marker=/tmp/magnibox-postfix-retry-first-attempt",
    "( set -C; : > \"$marker\" ) 2>/dev/null && exit 75",
    "exec /usr/bin/python3 /opt/magnibox-bridge/postfix-inbound.py \"$@\"",
    "",
  ].join("\n");
  const retryWrapperBase64 = Buffer.from(retryWrapper).toString("base64");
  execFileSync("docker", ["exec", "magnibox-mailserver", "sh", "-ec",
    "rm -f /tmp/magnibox-postfix-retry-first-attempt; printf %s " + retryWrapperBase64 + " | base64 -d > /tmp/magnibox-postfix-retry-wrapper.sh; chmod 755 /tmp/magnibox-postfix-retry-wrapper.sh"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postconf", "-e", "minimal_backoff_time=300s"]);
  execFileSync("docker", ["exec", "magnibox-mailserver", "sh", "-ec",
    "sed -i 's#argv=/usr/bin/python3 /opt/magnibox-bridge/postfix-inbound.py#argv=/tmp/magnibox-postfix-retry-wrapper.sh#' /etc/postfix/master.cf && postfix reload"]);
  const retryMessageId = "postfix-retry-" + stamp + "@magnisa.test";
  await smtp.sendMail({
    ...postfixMail,
    messageId: "<" + retryMessageId + ">",
    subject: "MAGNIBOX Postfix retry E2E " + stamp,
    text: "This message must remain queued after a temporary bridge failure and deliver after recovery.",
  });
  const queueDeadline = Date.now() + 30000;
  let queuedId = null;
  let queueSnapshot = "";
  while (Date.now() < queueDeadline) {
    const marker = spawnSync("docker", ["exec", "magnibox-mailserver", "test", "-f",
      "/tmp/magnibox-postfix-retry-first-attempt"]);
    queueSnapshot = execFileSync("docker", ["exec", "magnibox-mailserver", "postqueue", "-p"], { encoding: "utf8" });
    const match = queueSnapshot.match(/^([A-F0-9]{5,})[*!]?/m);
    if (marker.status === 0 && match && queueSnapshot.includes(recipient)) {
      queuedId = match[1];
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(queuedId, "Postfix must retain the SMTP message in its queue after the bridge returns EX_TEMPFAIL; queue=" + queueSnapshot);
  console.log("Inbound E2E: Postfix retained transiently failed message in queue " + queuedId);
  execFileSync("docker", ["exec", "magnibox-mailserver", "postqueue", "-i", queuedId]);
  let retriedMessage = null;
  const retryDeadline = Date.now() + 45000;
  while (Date.now() < retryDeadline) {
    const lookup = await admin.from("orbit_external_messages")
      .select("id,subject,body_text,provider_email_id")
      .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", retryMessageId).maybeSingle();
    if (lookup.error) throw lookup.error;
    if (lookup.data) { retriedMessage = lookup.data; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(retriedMessage, "Postfix queue retry after bridge recovery must persist the message");
  created.messageIds.push(retriedMessage.id);
  assert(retriedMessage.subject === "MAGNIBOX Postfix retry E2E " + stamp
    && retriedMessage.body_text.includes("after recovery"),
  "retried Postfix message content must be preserved");
  const remainingQueue = execFileSync("docker", ["exec", "magnibox-mailserver", "postqueue", "-p"], { encoding: "utf8" });
  assert(!remainingQueue.includes(queuedId),
    "successfully delivered Postfix retry must leave no queued copy; queue=" + remainingQueue);
  const retryCount = await admin.from("orbit_external_messages").select("id", { count: "exact", head: true })
    .eq("identity_id", identity.id).eq("direction", "incoming").eq("provider_email_id", retryMessageId);
  if (retryCount.error) throw retryCount.error;
  assert(retryCount.count === 1, "Postfix retry must persist exactly one message; got " + retryCount.count);
  console.log("Inbound E2E: queued message redelivered after recovery exactly once; queue cleared");

  // Unknown recipients must be refused by Postfix at SMTP RCPT time, before DATA.
  let unknownRejected = false;
  try {
    await smtp.sendMail({ from: "sender@mail.example.test", to: "missing@" + domain, subject: "Unknown recipient", text: "Must be rejected" });
  } catch (error) {
    unknownRejected = Number(error?.responseCode) === 550 || String(error?.response || "").includes("5.1.1");
  }
  assert(unknownRejected, "Postfix must reject a recipient absent from the provisioned virtual mailbox map");
  console.log("Inbound E2E: Postfix rejected an unknown recipient at SMTP RCPT");
  await smtp.close();

  console.log("PASS MAGNIBOX inbound: signed API, replay/conflict protection, MIME bridge, real Postfix SMTP delivery, transient queue retention and recovery, unauthorized attachment denial, unknown RCPT rejection, and private quarantine.");
} catch (error) {
  console.error("Inbound E2E failure diagnostics:", error);
  for (const args of [
    ["compose", "-f", "infra/magnibox-mail/compose.yaml", "-f", "infra/magnibox-mail/compose.inbound-e2e.yaml", "logs", "--tail=160", "mailserver"],
    ["exec", "magnibox-mailserver", "postconf", "-M"],
    ["exec", "magnibox-mailserver", "postconf", "-n"],
    ["exec", "magnibox-mailserver", "postqueue", "-p"],
  ]) {
    const diagnostic = spawnSync("docker", args, { encoding: "utf8" });
    console.error("DIAGNOSTIC docker " + args.join(" ") + "\\n" + (diagnostic.stdout || "") + (diagnostic.stderr || ""));
  }
  throw error;
} finally {
  if (created.storagePaths.length) await admin.storage.from("magnibox-attachments").remove(created.storagePaths).catch(() => {});
  if (created.identityId && created.messageIds.length) await admin.from("orbit_external_messages").delete()
    .eq("identity_id", created.identityId).eq("direction", "incoming").in("id", created.messageIds);
  if (created.identityId) await admin.from("orbit_public_identities").delete().eq("id", created.identityId);
  if (created.addressId) await admin.from("mgmail_public_address_requests").delete().eq("id", created.addressId);
  if (created.domainId) await admin.from("mgmail_domain_requests").delete().eq("id", created.domainId);
  if (created.mailboxId) await admin.from("mgmail_internal_mailboxes").delete().eq("id", created.mailboxId);
  if (created.organizationId) await admin.from("mgmail_internal_namespaces").delete().eq("organization_id", created.organizationId);
  if (created.unauthorizedUserId) await admin.auth.admin.deleteUser(created.unauthorizedUserId);
  if (created.userId) await admin.auth.admin.deleteUser(created.userId);
}
