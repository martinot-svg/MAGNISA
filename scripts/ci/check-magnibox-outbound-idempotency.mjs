import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/magnibox/internet/send/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261117200000_magnibox_outbound_request_fingerprint.sql", "utf8");
const contract = readFileSync("supabase/tests/magnibox-outbound-request-fingerprint-contract.sql", "utf8");

const checks = [
  ["fingerprint uses SHA-256", /createHash\("sha256"\)\.update\(JSON\.stringify\(\{/.test(route)],
  ["fingerprint includes identity and sender", /identityId:\s*identity\.id,\s*from:\s*identity\.email_address/.test(route)],
  ["fingerprint includes normalized recipients and body", /to:\s*input\.to,\s*subject:\s*input\.subject,\s*text:\s*input\.text/.test(route)],
  ["fingerprint includes verified attachment digests and transmitted filename", /attachmentFingerprint\.push\(\{id:item\.id,sha256:item\.sha256,byteSize:item\.byte_size,contentType:item\.detected_mime_type,filename\}\)/.test(route)],
  ["attachment order follows caller order", /attachmentIds\.map\(id => \(visible\.data \?\? \[\]\)\.find\(item => item\.id === id\)!\)/.test(route)],
  ["attachment filenames are restricted to safe characters", /display_name\.replace\(\/\[\^\\w \.\(\)-\]\/g, "_"/.test(route)],
  ["existing key compares fingerprint", /prior\.data\.request_fingerprint===requestFingerprint/.test(route)],
  ["concurrent duplicate compares fingerprint", /existing\.data\.request_fingerprint!==requestFingerprint/.test(route)],
  ["SQL reservation requires 64-char fingerprint", /p_request_fingerprint !~ '\^\[0-9a-f\]\{64\}\$'/.test(migration)],
  ["SQL stores fingerprint atomically with message", /subject, body_text, request_key, request_fingerprint, created_by/.test(migration)],
  ["legacy fingerprint-free RPC is dropped", /drop function public\.orbit_reserve_magnibox_outbound\(uuid,uuid,text,text\[\],text,text,uuid,uuid,integer\)/.test(migration)],
  ["SQL contract verifies new RPC", /orbit_reserve_magnibox_outbound\(uuid,uuid,text,text\[\],text,text,text,uuid,uuid,integer\)/.test(contract)],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} MAGNIBOX outbound idempotency: ${label}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
