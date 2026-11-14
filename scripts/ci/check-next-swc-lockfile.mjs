import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, root), "utf8"));
const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const packages = lock.packages || {};
const installedNext = packages["node_modules/next"];
const version = installedNext?.version;
const platforms = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-arm64-msvc",
  "win32-x64-msvc",
];
const errors = [];

if (lock.lockfileVersion !== 3) errors.push("package-lock.json doit utiliser lockfileVersion 3.");
if (!version || manifest.dependencies?.next !== version || packages[""]?.dependencies?.next !== version) {
  errors.push("Version Next.js incohérente entre package.json, le lockfile racine et node_modules/next (attendue : " + (version || "absente") + ").");
}
for (const platform of platforms) {
  const name = "@next/swc-" + platform;
  const entry = packages["node_modules/" + name];
  if (installedNext?.optionalDependencies?.[name] !== version) {
    errors.push(name + " manque dans les optionalDependencies de Next.js " + version + ".");
  }
  if (manifest.optionalDependencies?.[name] !== version || packages[""]?.optionalDependencies?.[name] !== version) {
    errors.push(name + " doit être déclaré à la version " + version + " dans les deux manifestes racine.");
  }
  if (!entry || entry.version !== version || entry.optional !== true || !entry.integrity || !entry.resolved || !entry.cpu?.length || !entry.os?.length) {
    errors.push(name + " absent, incomplet ou à une version différente dans package-lock.json.");
  }
}
const unexpected = Object.keys(installedNext?.optionalDependencies || {})
  .filter((name) => name.startsWith("@next/swc-") && !platforms.some((p) => name === "@next/swc-" + p));
if (unexpected.length) errors.push("Plateformes SWC nouvelles non déclarées : " + unexpected.join(", ") + ".");

if (errors.length) {
  console.error("ÉCHEC : lockfile Next.js / SWC incohérent :\n- " + errors.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("OK : Next.js " + version + " et " + platforms.length + " dépendances SWC optionnelles verrouillées pour toutes les plateformes.");
}
