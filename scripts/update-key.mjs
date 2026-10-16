// Creates the Ed25519 key pair that signs SoftConnect updates.
// The private key goes straight into the repository's SOFTCONNECT_UPDATE_KEY Actions secret through the
// GitHub CLI; it is never printed or written to disk. The public key is written to electron/update-key.cjs.
//
// Rotating the key cuts installed copies off from automatic updates: they only trust the old key, so
// people must download the first release signed with the new key by hand.
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repository = process.argv[2] || "mikkel32/SoftConnect";
const keyFile = join(root, "electron/update-key.cjs");

function setSecret(value) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["secret", "set", "SOFTCONNECT_UPDATE_KEY", "--repo", repository], { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`gh secret set exited with code ${code}`))));
    child.stdin.end(value);
  });
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
await setSecret(privateKey.export({ type: "pkcs8", format: "pem" }));
const publicPem = publicKey.export({ type: "spki", format: "pem" });
await writeFile(keyFile, `"use strict";

// Ed25519 public key that verifies SoftConnect update manifests. The matching private key exists only as
// the repository's SOFTCONNECT_UPDATE_KEY Actions secret. Regenerate both with \`npm run update-key\`.
const UPDATE_PUBLIC_KEY = \`${publicPem}\`;

module.exports = { UPDATE_PUBLIC_KEY };
`);
process.stdout.write(`Stored SOFTCONNECT_UPDATE_KEY on ${repository} and wrote ${keyFile}.\nCommit that file. The public key (safe to share) is:\n\n${publicPem}`);
