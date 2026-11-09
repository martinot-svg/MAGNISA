import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const manifestPath = process.env.STORAGE_MANIFEST_PATH ?? "backup/storage-manifest.json";
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage verification.");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let verified = 0;
let totalBytes = 0;
for (const object of manifest.objects) {
  const { data: blob, error } = await client.storage.from(object.bucket).download(object.path);
  if (error || !blob) {
    throw new Error(`Restored Storage object unavailable: ${object.bucket}/${object.path}`);
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== object.size || sha256 !== object.sha256) {
    throw new Error(`Restored Storage object failed SHA-256 verification: ${object.bucket}/${object.path}`);
  }
  verified += 1;
  totalBytes += bytes.length;
}
if (verified !== manifest.objectCount || totalBytes !== manifest.totalBytes) {
  throw new Error("Final Storage verification totals do not match the backup manifest.");
}
process.stdout.write(`PASS final Storage verification: ${verified} objects, ${totalBytes} bytes; restored metadata and binary content verified.\n`);
