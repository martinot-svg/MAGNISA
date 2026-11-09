import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageDir = path.resolve(process.env.STORAGE_BACKUP_DIR ?? "backup/storage");
const manifestPath = path.resolve(process.env.STORAGE_MANIFEST_PATH ?? "backup/storage-manifest.json");
const projectRef = process.env.SUPABASE_PROJECT_REF ?? null;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage export.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: buckets, error: bucketError } = await client.storage.listBuckets();
if (bucketError) throw bucketError;

await rm(storageDir, { recursive: true, force: true });
await mkdir(storageDir, { recursive: true });
await mkdir(path.dirname(manifestPath), { recursive: true });

const objects = [];
let totalBytes = 0;
const baseDir = path.resolve(storageDir);

function safeDestination(bucketName, objectPath) {
  const destination = path.resolve(baseDir, bucketName, ...objectPath.split("/"));
  if (!destination.startsWith(baseDir + path.sep)) {
    throw new Error("Unsafe Storage object path encountered; export aborted.");
  }
  return destination;
}

async function walkBucket(bucketName, prefix = "") {
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data: entries, error } = await client.storage.from(bucketName).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Storage listing failed for bucket ${bucketName}: ${error.message}`);
    if (!entries?.length) break;

    for (const entry of entries) {
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await walkBucket(bucketName, objectPath);
        continue;
      }

      const { data: blob, error: downloadError } = await client.storage.from(bucketName).download(objectPath);
      if (downloadError || !blob) {
        throw new Error(`Storage download failed for bucket ${bucketName}: ${downloadError?.message ?? "empty response"}`);
      }

      const bytes = Buffer.from(await blob.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const destination = safeDestination(bucketName, objectPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });

      const metadata = entry.metadata ?? {};
      objects.push({
        bucket: bucketName,
        path: objectPath,
        size: bytes.length,
        sha256,
        contentType: metadata.mimetype ?? metadata.contentType ?? "application/octet-stream",
        cacheControl: metadata.cacheControl ?? null,
        userMetadata: metadata.metadata ?? {},
        createdAt: entry.created_at ?? null,
        updatedAt: entry.updated_at ?? null,
      });
      totalBytes += bytes.length;
    }

    if (entries.length < limit) break;
    offset += entries.length;
  }
}

for (const bucket of buckets ?? []) {
  await walkBucket(bucket.name);
}

objects.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.path.localeCompare(b.path));
const manifest = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  projectRef,
  buckets: (buckets ?? []).map((bucket) => ({
    name: bucket.name,
    public: bucket.public,
    fileSizeLimit: bucket.file_size_limit ?? null,
    allowedMimeTypes: bucket.allowed_mime_types ?? null,
  })),
  objectCount: objects.length,
  totalBytes,
  objects,
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
process.stdout.write(`PASS Storage export: ${objects.length} objects, ${totalBytes} bytes across ${buckets?.length ?? 0} buckets; manifest and SHA-256 hashes recorded.\n`);
