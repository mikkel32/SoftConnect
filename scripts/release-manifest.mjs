// Builds and signs the update manifest that installed copies of SoftConnect verify before updating.
// CI usage: SOFTCONNECT_UPDATE_KEY=<Ed25519 private key PEM> node scripts/release-manifest.mjs <version> <release-dir> [notes-file]
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import updater from "../electron/updater.cjs";
import updateKey from "../electron/update-key.cjs";

const ARCHIVE = /^SoftConnect-(\d+\.\d+\.\d+)-mac-(arm64|x64)\.zip$/;
const MAX_NOTES_LENGTH = 4000;

export async function describeArchive(path, name) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { name, size, sha256: hash.digest("hex") };
}

export function createManifest({ version, archives, notes = "", released = new Date().toISOString() }) {
  const manifest = { app: "SoftConnect", bundleId: updater.BUNDLE_ID, version, released, notes, archives };
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

export function signManifest(bytes, privateKeyPem) {
  return sign(null, bytes, createPrivateKey(privateKeyPem)).toString("base64");
}

export function publicKeyFor(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" });
}

export async function writeSignedManifest({ version, directory, notes, privateKeyPem, publicKeyPem = updateKey.UPDATE_PUBLIC_KEY }) {
  if (publicKeyFor(privateKeyPem).trim() !== publicKeyPem.trim()) {
    throw new Error("SOFTCONNECT_UPDATE_KEY does not match electron/update-key.cjs, so installed apps would reject this release.");
  }
  const archives = {};
  for (const name of (await readdir(directory)).sort()) {
    const match = ARCHIVE.exec(name);
    if (!match) continue;
    if (match[1] !== version) throw new Error(`${name} does not belong to version ${version}.`);
    archives[match[2]] = await describeArchive(join(directory, name), name);
  }
  if (!Object.keys(archives).length) throw new Error(`No SoftConnect-${version}-mac-*.zip found in ${directory}.`);
  const manifest = createManifest({ version, archives, notes: (notes || "").trim().slice(0, MAX_NOTES_LENGTH) });
  const signature = signManifest(manifest, privateKeyPem);
  // Check the result exactly the way the app will before anything is published.
  updater.verifyManifest(manifest, signature, publicKeyPem);
  await writeFile(join(directory, updater.MANIFEST_NAME), manifest);
  await writeFile(join(directory, updater.SIGNATURE_NAME), `${signature}\n`);
  return { manifest: JSON.parse(manifest.toString("utf8")), signature };
}

async function main([version, directory, notesFile]) {
  if (!version || !directory) throw new Error("Usage: node scripts/release-manifest.mjs <version> <release-dir> [notes-file]");
  const privateKeyPem = process.env.SOFTCONNECT_UPDATE_KEY;
  if (!privateKeyPem) throw new Error("SOFTCONNECT_UPDATE_KEY is not set. Run `npm run update-key` once to create the signing key.");
  const notes = notesFile ? await readFile(notesFile, "utf8") : "";
  const { manifest } = await writeSignedManifest({ version, directory, notes, privateKeyPem });
  for (const [arch, archive] of Object.entries(manifest.archives)) {
    process.stdout.write(`${arch}: ${archive.name} ${archive.size} bytes sha256 ${archive.sha256}\n`);
  }
  process.stdout.write(`Signed ${updater.MANIFEST_NAME} for ${version}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
