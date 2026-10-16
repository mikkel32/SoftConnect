// Creates the Ed25519 key pair that signs SoftConnect updates.
//
//   npm run update-key                         first-time setup
//   npm run update-key -- --backup <file>      also save the private key to <file> (mode 600) for safekeeping
//   npm run update-key -- --rotate             replace an existing key (see below)
//
// The private key goes straight into the repository's SOFTCONNECT_UPDATE_KEY Actions secret through the
// GitHub CLI and is never printed. The public key is written to electron/update-key.cjs; commit that file.
//
// Installed copies trust only the key they shipped with. Rotating therefore cuts them off from automatic
// updates, and people must install the first release signed with the new key by hand. Keep a backup
// (for example in a password manager) so a lost secret can be restored instead of rotated.
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyFile = join(root, "electron/update-key.cjs");
const args = process.argv.slice(2);
const rotate = args.includes("--rotate");
const backupIndex = args.indexOf("--backup");
const backupPath = backupIndex >= 0 ? args[backupIndex + 1] : null;
const repository = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--backup") || "mikkel32/SoftConnect";

if (backupIndex >= 0 && !backupPath) throw new Error("--backup needs a file path.");
const existing = createRequire(import.meta.url)(keyFile).UPDATE_PUBLIC_KEY;
if (existing && !rotate) {
  process.stderr.write(`electron/update-key.cjs already has a public key. Replacing it cuts every installed copy off from
automatic updates. If the secret was lost, restore it from your backup:
  gh secret set SOFTCONNECT_UPDATE_KEY --repo ${repository} < your-backup.pem
To replace the key anyway, run: npm run update-key -- --rotate
`);
  process.exit(1);
}

function setSecret(value) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("gh", ["secret", "set", "SOFTCONNECT_UPDATE_KEY", "--repo", repository], { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolvePromise() : reject(new Error(`gh secret set exited with code ${code}`))));
    child.stdin.end(value);
  });
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
if (backupPath) await writeFile(resolve(backupPath), privatePem, { mode: 0o600, flag: "wx" });
await setSecret(privatePem);
const publicPem = publicKey.export({ type: "spki", format: "pem" });
await writeFile(keyFile, `"use strict";

// Ed25519 public key that verifies SoftConnect update manifests. The matching private key exists only as
// the repository's SOFTCONNECT_UPDATE_KEY Actions secret. See scripts/update-key.mjs before changing it.
const UPDATE_PUBLIC_KEY = \`${publicPem}\`;

module.exports = { UPDATE_PUBLIC_KEY };
`);
process.stdout.write(`Stored SOFTCONNECT_UPDATE_KEY on ${repository} and wrote electron/update-key.cjs. Commit and push that file.
${backupPath ? `The private key is also saved in ${resolve(backupPath)}. Move it somewhere safe, such as a password manager.\n` : ""}The public key (safe to share) is:

${publicPem}`);
