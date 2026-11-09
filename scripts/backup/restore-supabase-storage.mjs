import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageDir = path.resolve(process.env.STORAGE_BACKUP_DIR ?? "backup/storage");
const manifestPath = path.resolve(process.env.STORAGE_MANIFEST_PATH ?? "backup/storage-manifest.json");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage restore.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.formatVersion !== 1 || !Array.isArray(manifest.buckets) || !Array.isArray(manifest.objects)) {
  throw new Error("Unsupported or invalid Storage backup manifest.");
}

const { data: existingBuckets, error: listError } = await client.storage.listBuckets();
if (listError) throw listError;
const existingByName = new Map((existingBuckets ?? []).map((bucket) => [bucket.name, bucket]));

for (const bucket of manifest.buckets) {
  const existing = existingByName.get(bucket.name);
  if (!existing) {
    const { error } = await client.storage.createBucket(bucket.name, {
      public: Boolean(bucket.public),
      fileSizeLimit: bucket.fileSizeLimit ?? undefined,
      allowedMimeTypes: bucket.allowedMimeTypes ?? undefined,
    });
    if (error) throw new Error(`Could not restore Storage bucket ${bucket.name}: ${error.message}`);
    continue;
  }
  if (Boolean(existing.public) !== Boolean(bucket.public)) {
    throw new Error(`Storage bucket visibility mismatch for ${bucket.name}; restore stopped.`);
  }
}

const baseDir = path.resolve(storageDir);
function safeSource(bucketName, objectPath) {
  const source = path.resolve(baseDir, bucketName, ...objectPath.split("/"));
  if (!source.startsWith(baseDir + path.sep)) {
    throw new Error("Unsafe Storage object path in backup manifest.");
  }
  return source;
}

let restored = 0;
let totalBytes = 0;
for (const object of manifest.objects) {
  const source = safeSource(object.bucket, object.path);
  const bytes = await readFile(source);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  if (sourceHash !== object.sha256 || bytes.length !== object.size) {
    throw new Error(`Backup file integrity mismatch for ${object.bucket}/${object.path}.`);
  }

  const { error: uploadError } = await client.storage.from(object.bucket).upload(object.path, bytes, {
    upsert: true,
    contentType: object.contentType ?? "application/octet-stream",
    cacheControl: object.cacheControl ?? "3600",
    metadata: object.userMetadata ?? {},
  });
  if (uploadError) {
    throw new Error(`Storage upload failed for ${object.bucket}/${object.path}: ${uploadError.message}`);
  }

  const { data: restoredBlob, error: downloadError } = await client.storage.from(object.bucket).download(object.path);
  if (downloadError || !restoredBlob) {
    throw new Error(`Storage verification download failed for ${object.bucket}/${object.path}.`);
  }
  const restoredHash = createHash("sha256").update(Buffer.from(await restoredBlob.arrayBuffer())).digest("hex");
  if (restoredHash !== object.sha256) {
    throw new Error(`Restored Storage content hash mismatch for ${object.bucket}/${object.path}.`);
  }
  restored += 1;
  totalBytes += bytes.length;
}

if (restored !== manifest.objectCount || totalBytes !== manifest.totalBytes) {
  throw new Error("Storage restore totals do not match the encrypted backup manifest.");
}
process.stdout.write(`PASS Storage restore: ${restored} objects, ${totalBytes} bytes; every restored object SHA-256 verified.\n`);
