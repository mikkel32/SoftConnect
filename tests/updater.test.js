import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import updaterModule from "../electron/updater.cjs";
import { createManifest, signManifest, writeSignedManifest } from "../scripts/release-manifest.mjs";

const { DOWNLOAD_PREFIX, LATEST_RELEASE_URL, MANIFEST_NAME, SIGNATURE_NAME, STAGING_NAME, createUpdater, isNewer, memoryPreferences, verifyManifest } = updaterModule;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }), publicPem: publicKey.export({ type: "spki", format: "pem" }) };
}

// A fake GitHub release plus an installed SoftConnect.app in a temporary "Applications" folder.
async function fixture({
  version = "0.3.7",
  current = "0.3.0",
  servedArchive,
  tamperManifest = false,
  publicKey,
  mutateRelease,
  bundleVersion,
  execPath,
  packaged = true,
  autoUpdate = true,
  preferences = memoryPreferences({ autoUpdate }),
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "softconnect-updater-"));
  const bundle = join(root, "Applications/SoftConnect.app");
  await mkdir(join(bundle, "Contents/MacOS"), { recursive: true });
  await writeFile(join(bundle, "Contents/MacOS/SoftConnect"), "old version");
  const tempDir = join(root, "tmp");
  await mkdir(tempDir);

  const keys = keyPair();
  const archiveBytes = randomBytes(256 * 1024);
  const archiveName = `SoftConnect-${version}-mac-arm64.zip`;
  let manifest = createManifest({ version, archives: { arm64: { name: archiveName, size: archiveBytes.length, sha256: sha256(archiveBytes) } }, notes: "- Faster device list" });
  const signature = signManifest(manifest, keys.privatePem);
  if (tamperManifest) manifest = Buffer.from(manifest.toString("utf8").replace("Faster", "Evil"));

  const base = `${DOWNLOAD_PREFIX}v${version}/`;
  const release = {
    tag_name: `v${version}`,
    html_url: `https://github.com/mikkel32/SoftConnect/releases/tag/v${version}`,
    assets: [archiveName, MANIFEST_NAME, SIGNATURE_NAME].map((name) => ({ name, browser_download_url: `${base}${name}` })),
  };
  mutateRelease?.(release);
  const routes = new Map([
    [LATEST_RELEASE_URL, JSON.stringify(release)],
    [`${base}${MANIFEST_NAME}`, manifest],
    [`${base}${SIGNATURE_NAME}`, `${signature}\n`],
    [`${base}${archiveName}`, servedArchive || archiveBytes],
  ]);
  const requests = [];
  const fetch = async (url) => {
    requests.push(url);
    return routes.has(url) ? new Response(routes.get(url)) : new Response("not found", { status: 404 });
  };
  const tools = {
    // Stand-ins for ditto, plutil and codesign: the archive bytes become a new bundle on disk.
    extract: async (archive, directory) => {
      await readFile(archive);
      await mkdir(join(directory, "SoftConnect.app/Contents/MacOS"), { recursive: true });
      await writeFile(join(directory, "SoftConnect.app/Contents/MacOS/SoftConnect"), "new version");
    },
    bundleInfo: async () => ({ CFBundleIdentifier: "app.softconnect.desktop", CFBundleShortVersionString: bundleVersion || version }),
    verifySignature: async () => {},
  };
  const states = [];
  const options = {
    currentVersion: current,
    publicKey: publicKey === undefined ? keys.publicPem : publicKey,
    fetch,
    tools,
    tempDir,
    platform: "darwin",
    arch: "arm64",
    packaged,
    execPath: execPath || join(bundle, "Contents/MacOS/SoftConnect"),
    preferences,
    autoCheck: false,
    onStatus: (status) => states.push(status.state),
  };
  return {
    root, bundle, keys, requests, states, options, archiveName,
    updater: createUpdater(options),
    installed: () => readFile(join(bundle, "Contents/MacOS/SoftConnect"), "utf8"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("versions compare numerically, not as strings", () => {
  assert.equal(isNewer("0.3.10", "0.3.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.3.0", "0.3.0"), false);
  assert.equal(isNewer("0.2.9", "0.3.0"), false);
  assert.equal(isNewer("0.3", "0.2.0"), false);
});

test("a signed manifest verifies, and tampering or a different key is rejected", () => {
  const { privatePem, publicPem } = keyPair();
  const manifest = createManifest({ version: "1.2.3", archives: { arm64: { name: "SoftConnect-1.2.3-mac-arm64.zip", size: 10, sha256: "a".repeat(64) } } });
  const signature = signManifest(manifest, privatePem);
  assert.equal(verifyManifest(manifest, signature, publicPem).version, "1.2.3");
  const tampered = Buffer.from(manifest.toString("utf8").replace("1.2.3\",\n  \"released", "9.9.9\",\n  \"released"));
  assert.throws(() => verifyManifest(tampered, signature, publicPem), /signature is not valid/);
  assert.throws(() => verifyManifest(manifest, signature, keyPair().publicPem), /signature is not valid/);
  assert.throws(() => verifyManifest(manifest, "not base64!", publicPem), /signature is not valid/);
  const wrongArchive = createManifest({ version: "1.2.3", archives: { arm64: { name: "SoftConnect-1.2.4-mac-arm64.zip", size: 10, sha256: "a".repeat(64) } } });
  assert.throws(() => verifyManifest(wrongArchive, signManifest(wrongArchive, privatePem), publicPem), /invalid archive/);
});

test("release signing refuses a key the app would not trust and signs every archive in the directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "softconnect-release-"));
  try {
    const signing = keyPair();
    await writeFile(join(directory, "SoftConnect-0.3.4-mac-arm64.zip"), "arm build");
    await writeFile(join(directory, "notes.txt"), "ignored");
    await assert.rejects(() => writeSignedManifest({ version: "0.3.4", directory, privateKeyPem: signing.privatePem, publicKeyPem: keyPair().publicPem }), /does not match/);
    const { manifest } = await writeSignedManifest({ version: "0.3.4", directory, notes: "- Change", privateKeyPem: signing.privatePem, publicKeyPem: signing.publicPem });
    assert.deepEqual(Object.keys(manifest.archives), ["arm64"]);
    assert.equal(manifest.archives.arm64.sha256, sha256(Buffer.from("arm build")));
    const written = await readFile(join(directory, MANIFEST_NAME));
    const signature = await readFile(join(directory, SIGNATURE_NAME), "utf8");
    assert.equal(verifyManifest(written, signature, signing.publicPem).notes, "- Change");
    await assert.rejects(() => writeSignedManifest({ version: "0.3.5", directory, privateKeyPem: signing.privatePem, publicKeyPem: signing.publicPem }), /does not belong to version 0.3.5/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a newer release downloads, verifies, stages and replaces the app when it quits", async () => {
  const preferences = memoryPreferences();
  const env = await fixture({ preferences });
  try {
    const checked = await env.updater.check();
    assert.equal(checked.state, "available");
    assert.equal(checked.latestVersion, "0.3.7");
    assert.equal(checked.notes, "- Faster device list");
    const ready = await env.updater.download();
    assert.equal(ready.state, "ready", ready.error);
    assert.deepEqual(env.states.filter((state, index, all) => state !== all[index - 1]), ["checking", "available", "downloading", "verifying", "ready"]);
    assert.equal(await env.installed(), "old version", "nothing changes before quit");

    assert.equal(env.updater.installOnQuit(), true);
    assert.equal(await env.installed(), "new version");
    assert.equal(await readFile(join(env.root, "Applications", STAGING_NAME, "SoftConnect-previous.app/Contents/MacOS/SoftConnect"), "utf8"), "old version");
    assert.equal(env.updater.installOnQuit(), false, "installs once");

    // The relaunched version reports where it came from and removes the backup.
    const relaunched = createUpdater({ ...env.options, currentVersion: "0.3.7", preferences });
    await relaunched.start();
    assert.equal(relaunched.getStatus().updatedFrom, "0.3.0");
    assert.deepEqual(await readdir(join(env.root, "Applications")), ["SoftConnect.app"]);
    assert.equal(preferences.load().pendingInstall, undefined);
  } finally {
    await env.cleanup();
  }
});

test("an up-to-date app downloads nothing", async () => {
  const env = await fixture({ version: "0.3.0", current: "0.3.0" });
  try {
    const status = await env.updater.check();
    assert.equal(status.state, "up-to-date");
    assert.deepEqual(env.requests, [LATEST_RELEASE_URL]);
  } finally {
    await env.cleanup();
  }
});

test("a tampered manifest is refused before any download", async () => {
  const env = await fixture({ tamperManifest: true });
  try {
    const status = await env.updater.check();
    assert.equal(status.state, "error");
    assert.match(status.error, /signature is not valid/);
    assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
  } finally {
    await env.cleanup();
  }
});

test("a manifest signed with a key the app does not ship is refused", async () => {
  const env = await fixture({ publicKey: keyPair().publicPem });
  try {
    assert.match((await env.updater.check()).error, /signature is not valid/);
  } finally {
    await env.cleanup();
  }
});

test("an archive that does not match the signed checksum is discarded and the app is untouched", async () => {
  const env = await fixture({ servedArchive: randomBytes(256 * 1024) });
  try {
    await env.updater.check();
    const status = await env.updater.download();
    assert.equal(status.state, "error");
    assert.match(status.error, /integrity check/);
    assert.equal(env.updater.installOnQuit(), false);
    assert.equal(await env.installed(), "old version");
    assert.deepEqual(await readdir(join(env.root, "Applications")), ["SoftConnect.app"]);
  } finally {
    await env.cleanup();
  }
});

test("downloads outside this repository's releases are refused", async () => {
  const env = await fixture({
    mutateRelease: (release) => { release.assets[0].browser_download_url = "https://example.com/SoftConnect-0.3.7-mac-arm64.zip"; },
  });
  try {
    const status = await env.updater.check();
    assert.equal(status.state, "error");
    assert.match(status.error, /missing SoftConnect-0\.3\.7-mac-arm64\.zip/);
  } finally {
    await env.cleanup();
  }
});

test("a downloaded app with the wrong version is not staged", async () => {
  const env = await fixture({ bundleVersion: "0.3.6" });
  try {
    await env.updater.check();
    const status = await env.updater.download();
    assert.match(status.error, /does not match the expected bundle or version/);
    assert.deepEqual(await readdir(join(env.root, "Applications")), ["SoftConnect.app"]);
  } finally {
    await env.cleanup();
  }
});

test("a failed swap puts the original app back", async () => {
  const env = await fixture();
  try {
    await env.updater.check();
    await env.updater.download();
    await rm(join(env.root, "Applications", STAGING_NAME, "SoftConnect.app"), { recursive: true });
    assert.equal(env.updater.installNow(), false);
    assert.match(env.updater.getStatus().error, /Couldn't install the update/);
    assert.equal(await env.installed(), "old version");
  } finally {
    await env.cleanup();
  }
});

test("with automatic updates off, a new version is announced but only downloaded on request", async () => {
  const env = await fixture({ autoUpdate: false });
  try {
    assert.equal((await env.updater.check()).state, "available");
    assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
    assert.equal((await env.updater.download()).state, "ready");
  } finally {
    await env.cleanup();
  }
});

test("locations that cannot self-update still report new versions but never install", async () => {
  const cases = [
    [{ execPath: "/private/var/folders/x/AppTranslocation/ABC/d/SoftConnect.app/Contents/MacOS/SoftConnect" }, /Applications folder/],
    [{ packaged: false }, /development builds/],
    [{ publicKey: null }, /no update signing key/],
  ];
  for (const [options, reason] of cases) {
    const env = await fixture(options);
    try {
      const status = await env.updater.check();
      assert.equal(status.state, "available");
      assert.equal(status.canInstall, false);
      assert.match(status.installBlockedReason, reason);
      assert.equal((await env.updater.download()).state, "available");
      assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
    } finally {
      await env.cleanup();
    }
  }
});
