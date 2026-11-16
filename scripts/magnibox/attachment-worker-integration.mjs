import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, unlink, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Set local Supabase URL, anon key and service-role key.");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) {
  throw new Error("Safety stop: this integration test only accepts localhost Supabase.");
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const email = "magnibox-worker-" + randomUUID() + "@magnisa.test";
const password = "Worker-" + randomBytes(20).toString("hex") + "!9";
const stamp = randomUUID().replaceAll("-", "").slice(0, 12);
const bucket = "magnibox-attachments";
const compose = ["compose", "-f", "infra/magnibox-mail/compose.local.yaml"];
const created = { userId: null, secondUserId: null, organizationId: null, secondOrganizationId: null, mailboxId: null, domainId: null, addressId: null, identityId: null, messageId: null, paths: [] };
const fixtures = [
  { name: "clean.pdf", bytes: Buffer.from("%PDF-1.7\nMAGNIBOX LOCAL E2E\n%%EOF\n"), contentType: "application/pdf", expected: "available", validHash: true },
  { name: "eicar.txt", bytes: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"), contentType: "text/plain", expected: "rejected", validHash: true },
  { name: "unsupported.bin", bytes: Buffer.from([0, 1, 2, 3, 255, 0, 9]), contentType: "image/png", expected: "rejected", validHash: true },
  { name: "bad-sha.txt", bytes: Buffer.from("MAGNIBOX hash mismatch fixture"), contentType: "text/plain", expected: "quarantined", validHash: false },
];
function assert(condition, message) { if (!condition) throw new Error(message); }
function unwrap(result, label) {
  if (result.error || result.data == null) throw new Error(label + ": " + (result.error?.message ?? "no data"));
  return result.data;
}
let generatedEnvFile = false;
async function workerOnce(clamHost, clamPort) {
  const args = [...compose, "run", "--rm", "--no-deps",
    "-e", "NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321",
    "-e", "SUPABASE_SERVICE_ROLE_KEY=" + serviceKey];
  if (clamHost) args.push("-e", "MAGNIBOX_CLAMAV_HOST=" + clamHost);
  if (clamPort) args.push("-e", "MAGNIBOX_CLAMAV_PORT=" + clamPort);
  args.push("attachment-worker", "./node_modules/.bin/tsx", "scripts/magnibox/scan-attachments.ts");
  await execFileAsync("docker", args, { maxBuffer: 1024 * 1024 });
}
try {
  try { await access("infra/magnibox-mail/.env.local-dev"); }
  catch {
    await writeFile("infra/magnibox-mail/.env.local-dev", "# generated temporarily by local E2E test\\n", { mode: 0o600, flag: "wx" });
    generatedEnvFile = true;
  }
  const user = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create local test user");
  created.userId = user.user.id;
  const owner = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await owner.auth.signInWithPassword({ email, password }), "sign in test owner");
  const org = unwrap(await owner.rpc("create_organization", {
    p_name: "MAGNIBOX Worker E2E " + stamp, p_currency: "MGA",
  }), "create isolated test organization");
  created.organizationId = org;
  unwrap(await owner.from("mgmail_internal_namespaces").insert({ organization_id: org, slug: "magnibox-e2e-" + stamp }).select("organization_id").single(), "create internal namespace");
  const mailbox = unwrap(await owner.from("mgmail_internal_mailboxes").insert({
    organization_id: org, local_part: "scanner", owner_user_id: user.user.id, display_name: "MAGNIBOX E2E scanner",
  }).select("id").single(), "create test mailbox");
  created.mailboxId = mailbox.id;
  const domain = "magnibox-e2e-" + stamp + ".example.org";
  const domainRequest = unwrap(await owner.from("mgmail_domain_requests").insert({
    organization_id: org, domain_name: domain, requested_by: user.user.id,
  }).select("id").single(), "create local domain request");
  created.domainId = domainRequest.id;
  const addressRequest = unwrap(await owner.from("mgmail_public_address_requests").insert({
    organization_id: org, mailbox_id: mailbox.id, domain_request_id: domainRequest.id,
    domain_name: domain, local_part: "scanner", requested_by: user.user.id,
  }).select("id").single(), "create local address request");
  created.addressId = addressRequest.id;

  unwrap(await admin.from("mgmail_domain_requests").update({
    status: "verified", verified_at: new Date().toISOString(), proof_reference: "local-e2e-fixture-only",
  }).eq("id", created.domainId).select("id").single(), "approve local test domain");
  unwrap(await admin.from("mgmail_public_address_requests").update({ status: "approved" })
    .eq("id", created.addressId).select("id").single(), "approve local test address");
  const identity = unwrap(await admin.from("orbit_public_identities").insert({
    organization_id: org, domain_request_id: created.domainId, address_request_id: created.addressId,
    mailbox_id: mailbox.id, domain_name: domain, local_part: "scanner", provider: "smtp",
    provider_domain_ref: "local-e2e-no-transport", provider_verified_at: new Date().toISOString(),
    status: "active", receive_enabled: true,
  }).select("id").single(), "create local-only identity");
  created.identityId = identity.id;
  const message = unwrap(await admin.from("orbit_external_messages").insert({
    organization_id: org, identity_id: identity.id, direction: "incoming", status: "received",
    from_email: "fixture@example.invalid", to_emails: ["scanner@" + domain],
    subject: "MAGNIBOX worker integration fixture", body_text: "Synthetic local-only message.",
    provider_email_id: "local-e2e-" + stamp,
  }).select("id").single(), "create local-only message");
  created.messageId = message.id;

  const ids = [];
  for (const fixture of fixtures) {
    const id = randomUUID();
    const path = org + "/" + message.id + "/" + id;
    const upload = await admin.storage.from(bucket).upload(path, fixture.bytes, { contentType: fixture.contentType, upsert: false });
    if (upload.error) throw new Error("upload " + fixture.name + ": " + upload.error.message);
    created.paths.push(path);
    const digest = createHash("sha256").update(fixture.bytes).digest("hex");
    const row = unwrap(await admin.from("orbit_external_message_attachments").insert({
      id, organization_id: org, message_id: message.id, storage_path: path,
      display_name: fixture.name, detected_mime_type: "application/octet-stream",
      byte_size: fixture.bytes.length, sha256: fixture.validHash ? digest : "0".repeat(64),
      scan_status: "quarantined",
    }).select("id").single(), "create metadata " + fixture.name);
    ids.push({ ...fixture, id: row.id, path });
  }

  await execFileAsync("docker", [...compose, "up", "-d", "--wait", "clamav"], { maxBuffer: 1024 * 1024 });
  await Promise.all([workerOnce(), workerOnce()]);

  // Prove a scanner outage is retryable and never publishes an attachment.
  const retryBytes = Buffer.from("MAGNIBOX retry after scanner outage");
  const retryId = randomUUID();
  const retryPath = org + "/" + message.id + "/" + retryId;
  const retryUpload = await admin.storage.from(bucket).upload(retryPath, retryBytes, { contentType: "text/plain", upsert: false });
  if (retryUpload.error) throw new Error("upload outage retry fixture: " + retryUpload.error.message);
  created.paths.push(retryPath);
  const retryDigest = createHash("sha256").update(retryBytes).digest("hex");
  unwrap(await admin.from("orbit_external_message_attachments").insert({
    id: retryId, organization_id: org, message_id: message.id, storage_path: retryPath,
    display_name: "scanner-outage-retry.txt", detected_mime_type: "text/plain",
    byte_size: retryBytes.length, sha256: retryDigest, scan_status: "quarantined",
  }).select("id").single(), "create scanner outage fixture");
  ids.push({ name: "scanner-outage-retry.txt", id: retryId, path: retryPath, expected: "available", expectedAttempts: 2 });
  await workerOnce("127.0.0.1", "1");
  const outageState = unwrap(await admin.from("orbit_external_message_attachments")
    .select("scan_status,scan_attempts,scan_lease_token,scan_started_at").eq("id", retryId).single(),
    "read scanner outage state");
  assert(outageState.scan_status === "quarantined", "ClamAV outage must keep the attachment quarantined");
  assert(outageState.scan_attempts === 1, "ClamAV outage should consume exactly one attempt");
  assert(outageState.scan_lease_token === null && outageState.scan_started_at === null,
    "ClamAV outage must release its lease for retry");

  // Simulate a worker crash by leaving a scan lease older than the 15-minute recovery threshold.
  const staleBytes = Buffer.from("MAGNIBOX stale lease recovery");
  const staleId = randomUUID();
  const stalePath = org + "/" + message.id + "/" + staleId;
  const staleUpload = await admin.storage.from(bucket).upload(stalePath, staleBytes, { contentType: "text/plain", upsert: false });
  if (staleUpload.error) throw new Error("upload stale lease fixture: " + staleUpload.error.message);
  created.paths.push(stalePath);
  const staleDigest = createHash("sha256").update(staleBytes).digest("hex");
  unwrap(await admin.from("orbit_external_message_attachments").insert({
    id: staleId, organization_id: org, message_id: message.id, storage_path: stalePath,
    display_name: "stale-lease-recovery.txt", detected_mime_type: "text/plain",
    byte_size: staleBytes.length, sha256: staleDigest, scan_status: "scanning",
    scan_attempts: 1, scan_started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    scan_lease_token: randomUUID(),
  }).select("id").single(), "create stale lease fixture");
  ids.push({ name: "stale-lease-recovery.txt", id: staleId, path: stalePath, expected: "available", expectedAttempts: 2 });
  await workerOnce();

  const rows = unwrap(await admin.from("orbit_external_message_attachments")
    .select("id,scan_status,scan_attempts,scan_lease_token,scan_started_at")
    .in("id", ids.map(item => item.id)), "read final scan states");
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const fixture of ids) {
    const row = byId.get(fixture.id);
    assert(row, "missing result for " + fixture.name);
    assert(row.scan_status === fixture.expected, fixture.name + ": expected " + fixture.expected + ", got " + row.scan_status);
    assert(row.scan_lease_token === null && row.scan_started_at === null, fixture.name + ": scan lease was not released");
    assert(row.scan_attempts === (fixture.expectedAttempts ?? 1), fixture.name + ": unexpected scan attempt count " + row.scan_attempts);
  }
  const clean = ids.find(item => item.name === "clean.pdf");
  const cleanDownload = await admin.storage.from(bucket).download(clean.path);
  assert(!cleanDownload.error && cleanDownload.data, "clean attachment object should remain available");
  for (const name of ["eicar.txt", "unsupported.bin"]) {
    const fixture = ids.find(item => item.name === name);
    const download = await admin.storage.from(bucket).download(fixture.path);
    assert(download.error || !download.data, name + ": rejected object must be removed");
  }
  const badHash = ids.find(item => item.name === "bad-sha.txt");
  const badHashDownload = await admin.storage.from(bucket).download(badHash.path);
  assert(!badHashDownload.error && badHashDownload.data, "hash mismatch must remain quarantined, not be published or deleted");

  // Verify tenant isolation with a second authenticated user in a different organization.
  const secondEmail = "magnibox-isolation-" + randomUUID() + "@magnisa.test";
  const secondPassword = "Isolation-" + randomBytes(20).toString("hex") + "!9";
  const secondUser = unwrap(await admin.auth.admin.createUser({
    email: secondEmail, password: secondPassword, email_confirm: true,
  }), "create second isolated test user");
  created.secondUserId = secondUser.user.id;
  const secondOwner = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await secondOwner.auth.signInWithPassword({ email: secondEmail, password: secondPassword }),
    "sign in second isolated test owner");
  created.secondOrganizationId = unwrap(await secondOwner.rpc("create_organization", {
    p_name: "MAGNIBOX Isolation E2E " + stamp, p_currency: "MGA",
  }), "create second isolated organization");
  const crossTenantRead = await secondOwner.from("orbit_external_message_attachments")
    .select("id").eq("id", clean.id);
  if (crossTenantRead.error) throw new Error("cross-tenant RLS query failed: " + crossTenantRead.error.message);
  assert((crossTenantRead.data ?? []).length === 0,
    "a user from another organization must not read this attachment metadata");

  console.log("PASS MAGNIBOX worker + Storage + ClamAV: clean available; EICAR and unsupported rejected/deleted; bad SHA quarantined; outage retry and stale lease recovered; cross-organization RLS isolation enforced.");
} finally {
  if (created.paths.length) await admin.storage.from(bucket).remove(created.paths).catch(() => {});
  if (created.messageId) await admin.from("orbit_external_messages").delete().eq("id", created.messageId);
  if (created.identityId) await admin.from("orbit_public_identities").delete().eq("id", created.identityId);
  if (created.addressId) await admin.from("mgmail_public_address_requests").delete().eq("id", created.addressId);
  if (created.domainId) await admin.from("mgmail_domain_requests").delete().eq("id", created.domainId);
  if (created.mailboxId) await admin.from("mgmail_internal_mailboxes").delete().eq("id", created.mailboxId);
  // Remove the namespace explicitly; otherwise its organization foreign key can
  // leave synthetic test data behind when the organization delete is attempted.
  if (created.organizationId) await admin.from("mgmail_internal_namespaces").delete().eq("organization_id", created.organizationId);
  if (created.organizationId) await admin.from("organizations").delete().eq("id", created.organizationId);
  if (created.userId) await admin.auth.admin.deleteUser(created.userId);
  await execFileAsync("docker", [...compose, "down"], { maxBuffer: 1024 * 1024 }).catch(() => {});
  if (generatedEnvFile) await unlink("infra/magnibox-mail/.env.local-dev").catch(() => {});
}
