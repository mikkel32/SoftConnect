import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import updaterModule from "../electron/updater.cjs";
import { createManifest, signManifest, writeSignedManifest } from "../scripts/release-manifest.mjs";

const { DOWNLOAD_PREFIX, LATEST_RELEASE_URL, MANIFEST_NAME, SIGNATURE_NAME, STAGING_NAME, createUpdater, isNewer, isReleaseUrl, memoryPreferences, verifyManifest } = updaterModule;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }), publicPem: publicKey.export({ type: "spki", format: "pem" }) };
}

async function writeBundle(app, version) {
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await writeFile(join(app, "Contents/MacOS/SoftConnect"), `SoftConnect ${version}`);
  await writeFile(join(app, "Contents/version"), version);
}

// A fake GitHub plus an installed SoftConnect.app in a temporary "Applications" folder. ditto, plutil
// and codesign are replaced by stand-ins that read and write a version marker inside the bundle.
async function fixture({ current = "0.3.0", autoUpdate = true, publicKey, execPath, packaged = true, preferences, timeouts = { metadata: 2000, downloadIdle: 2000 }, wrapTools = (tools) => tools } = {}) {
  const root = await mkdtemp(join(tmpdir(), "softconnect-updater-"));
  const applications = join(root, "Applications");
  const bundle = join(applications, "SoftConnect.app");
  await writeBundle(bundle, current);
  const tempDir = join(root, "tmp");
  await mkdir(tempDir);
  const keys = keyPair();
  const routes = new Map();
  const stalled = new Set();
  const archives = new Map();
  const requests = [];
  let extractGate = null;

  function publish(version, { tamperManifest = false, servedArchive, mutateRelease, bundleVersion, symlinkBundle = false } = {}) {
    const archiveBytes = randomBytes(64 * 1024);
    const name = `SoftConnect-${version}-mac-arm64.zip`;
    let manifest = createManifest({ version, archives: { arm64: { name, size: archiveBytes.length, sha256: sha256(archiveBytes) } }, notes: `- Changes in ${version}` });
    const signature = signManifest(manifest, keys.privatePem);
    if (tamperManifest) manifest = Buffer.from(manifest.toString("utf8").replace("Changes", "Malware"));
    const base = `${DOWNLOAD_PREFIX}v${version}/`;
    const release = {
      tag_name: `v${version}`,
      html_url: `https://github.com/mikkel32/SoftConnect/releases/tag/v${version}`,
      assets: [name, MANIFEST_NAME, SIGNATURE_NAME].map((asset) => ({ name: asset, browser_download_url: `${base}${asset}` })),
    };
    mutateRelease?.(release);
    routes.set(LATEST_RELEASE_URL, JSON.stringify(release));
    routes.set(`${base}${MANIFEST_NAME}`, manifest);
    routes.set(`${base}${SIGNATURE_NAME}`, `${signature}\n`);
    routes.set(`${base}${name}`, servedArchive || archiveBytes);
    archives.set(name, { version: bundleVersion || version, symlinkBundle });
    return { archiveUrl: `${base}${name}` };
  }

  const fetch = async (url) => {
    requests.push(url);
    if (stalled.has(url)) {
      // Headers arrive, then the body never finishes (or never starts, for metadata).
      if (url.endsWith(".zip")) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16)); } }));
      return new Promise(() => {});
    }
    return routes.has(url) ? new Response(routes.get(url)) : new Response("not found", { status: 404 });
  };
  const tools = {
    extract: async (archive, directory) => {
      await readFile(archive);
      const info = archives.get(basename(archive));
      if (extractGate) await extractGate;
      if (info.symlinkBundle) {
        await writeBundle(join(root, "elsewhere.app"), info.version);
        await symlink(join(root, "elsewhere.app"), join(directory, "SoftConnect.app"));
      } else {
        await writeBundle(join(directory, "SoftConnect.app"), info.version);
      }
    },
    bundleInfo: async (app) => ({ CFBundleIdentifier: "app.softconnect.desktop", CFBundleShortVersionString: await readFile(join(app, "Contents/version"), "utf8") }),
    verifySignature: async () => {},
    versionSync: (app) => { try { return readFileSync(join(app, "Contents/version"), "utf8"); } catch { return null; } },
  };
  const states = [];
  const options = {
    currentVersion: current,
    publicKey: publicKey === undefined ? keys.publicPem : publicKey,
    fetch,
    tools: wrapTools(tools),
    tempDir,
    platform: "darwin",
    arch: "arm64",
    packaged,
    execPath: execPath || join(bundle, "Contents/MacOS/SoftConnect"),
    preferences: preferences || memoryPreferences({ autoUpdate }),
    autoCheck: false,
    timeouts,
    onStatus: (status) => states.push(status.state),
  };
  const updater = createUpdater(options);
  return {
    root, applications, bundle, keys, requests, states, options, updater, publish, stalled,
    gateExtraction() {
      let open;
      extractGate = new Promise((resolve) => { open = resolve; });
      return () => { extractGate = null; open(); };
    },
    installed: () => readFile(join(bundle, "Contents/MacOS/SoftConnect"), "utf8"),
    stagedApps: async () => {
      const entries = await readdir(join(applications, STAGING_NAME)).catch(() => []);
      return entries.filter((entry) => entry !== "SoftConnect-previous.app");
    },
    waitFor: async (state) => {
      for (let attempt = 0; attempt < 300 && updater.getStatus().state !== state; attempt += 1) await tick();
      assert.equal(updater.getStatus().state, state, updater.getStatus().error || undefined);
    },
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

test("only this repository's release URLs are accepted", () => {
  assert.equal(isReleaseUrl("https://github.com/mikkel32/SoftConnect/releases/download/v1.0.0/a.zip", true), true);
  assert.equal(isReleaseUrl("https://github.com/mikkel32/softconnect/releases/tag/v1.0.0"), true);
  assert.equal(isReleaseUrl("https://github.com/mikkel32/SoftConnect/releases/../../evil/releases/download/x", true), false);
  assert.equal(isReleaseUrl("https://github.com.evil.example/mikkel32/SoftConnect/releases/download/x", true), false);
  assert.equal(isReleaseUrl("http://github.com/mikkel32/SoftConnect/releases/download/x", true), false);
  assert.equal(isReleaseUrl("https://user@github.com/mikkel32/SoftConnect/releases/download/x", true), false);
  assert.equal(isReleaseUrl("https://github.com/mikkel32/SoftConnect/releases/tag/v1", true), false);
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
    env.publish("0.3.7");
    const checked = await env.updater.check();
    assert.equal(checked.state, "downloading", "automatic updates start the download right away");
    assert.equal(checked.notes, "- Changes in 0.3.7");
    const ready = await env.updater.download();
    assert.equal(ready.state, "ready", ready.error);
    assert.deepEqual(env.states.filter((state, index, all) => state !== all[index - 1]), ["checking", "available", "downloading", "verifying", "ready"]);
    assert.equal(await env.installed(), "SoftConnect 0.3.0", "nothing changes before quit");

    assert.equal(env.updater.installOnQuit(), true);
    assert.equal(await env.installed(), "SoftConnect 0.3.7");
    assert.equal(await readFile(join(env.applications, STAGING_NAME, "SoftConnect-previous.app/Contents/MacOS/SoftConnect"), "utf8"), "SoftConnect 0.3.0");
    assert.equal(env.updater.installOnQuit(), false, "installs once");

    // The relaunched version reports where it came from and removes the backup.
    const relaunched = createUpdater({ ...env.options, currentVersion: "0.3.7", preferences });
    await relaunched.start();
    assert.equal(relaunched.getStatus().updatedFrom, "0.3.0");
    assert.deepEqual(await readdir(env.applications), ["SoftConnect.app"]);
    assert.equal(preferences.load().pendingInstall, undefined);
  } finally {
    await env.cleanup();
  }
});

test("quitting while a newer release is being unpacked never installs a half-written bundle", async () => {
  const env = await fixture();
  try {
    env.publish("0.3.7");
    await env.updater.check();
    await env.waitFor("ready");
    env.publish("0.3.8");
    const open = env.gateExtraction();
    await env.updater.check();
    await env.waitFor("verifying");
    assert.equal(env.updater.installOnQuit(), false, "0.3.7 was replaced by 0.3.8 and 0.3.8 is not verified yet");
    assert.equal(await env.installed(), "SoftConnect 0.3.0");
    open();
    await env.waitFor("ready");
    assert.equal(env.updater.getStatus().latestVersion, "0.3.8");
    assert.equal((await env.stagedApps()).length, 1, "the replaced staging folder was removed");
    assert.equal(env.updater.installOnQuit(), true);
    assert.equal(await env.installed(), "SoftConnect 0.3.8");
  } finally {
    await env.cleanup();
  }
});

test("a staged bundle that changed on disk after verification is not installed", async () => {
  for (const damage of ["remove executable", "change version"]) {
    const env = await fixture();
    try {
      env.publish("0.3.7");
      await env.updater.check();
      await env.waitFor("ready");
      const [folder] = await env.stagedApps();
      const app = join(env.applications, STAGING_NAME, folder, "SoftConnect.app");
      if (damage === "remove executable") await rm(join(app, "Contents/MacOS/SoftConnect"));
      else await writeFile(join(app, "Contents/version"), "6.6.6");
      assert.equal(env.updater.installNow(), false, damage);
      assert.match(env.updater.getStatus().error, damage === "remove executable" ? /incomplete/ : /changed after it was verified/);
      assert.equal(await env.installed(), "SoftConnect 0.3.0");
    } finally {
      await env.cleanup();
    }
  }
});

test("an update never replaces a newer copy someone installed by hand", async () => {
  const env = await fixture();
  try {
    env.publish("0.3.7");
    await env.updater.check();
    await env.waitFor("ready");
    await writeBundle(env.bundle, "0.3.9");
    assert.equal(env.updater.installOnQuit(), false);
    assert.match(env.updater.getStatus().error, /0\.3\.9 is already installed/);
    assert.equal(await env.installed(), "SoftConnect 0.3.9");
  } finally {
    await env.cleanup();
  }
});

test("what installs on quit always matches what the interface shows", { timeout: 30000 }, async (t) => {
  await t.test("a failed background check keeps a staged update ready", async () => {
    const env = await fixture();
    try {
      env.publish("0.3.7");
      await env.updater.check();
      await env.waitFor("ready");
      env.stalled.add(LATEST_RELEASE_URL);
      const fast = createUpdater({ ...env.options, timeouts: { metadata: 50, downloadIdle: 50 } });
      assert.equal((await fast.check()).state, "error", "a fresh updater reports the failure");
      assert.equal((await env.updater.check()).state, "ready", "this one keeps showing the staged update");
      assert.equal(env.updater.installOnQuit(), true);
    } finally {
      await env.cleanup();
    }
  });

  await t.test("turning automatic updates off withdraws an update it downloaded on its own", async () => {
    const env = await fixture();
    try {
      env.publish("0.3.7");
      await env.updater.check();
      await env.waitFor("ready");
      assert.equal(env.updater.setAutoUpdate(false).state, "available");
      assert.equal(env.updater.installOnQuit(), false);
    } finally {
      await env.cleanup();
    }
  });

  await t.test("an update you downloaded yourself stays when automatic updates are turned off", async () => {
    const env = await fixture({ autoUpdate: false });
    try {
      env.publish("0.3.7");
      await env.updater.check();
      assert.equal((await env.updater.download({ explicit: true })).state, "ready");
      assert.equal(env.updater.setAutoUpdate(false).state, "ready");
      assert.equal(env.updater.installOnQuit(), true);
    } finally {
      await env.cleanup();
    }
  });

  await t.test("a withdrawn release is discarded", async () => {
    const env = await fixture();
    try {
      env.publish("0.3.7");
      await env.updater.check();
      await env.waitFor("ready");
      env.publish("0.3.0");
      assert.equal((await env.updater.check()).state, "up-to-date");
      assert.equal(env.updater.installOnQuit(), false);
    } finally {
      await env.cleanup();
    }
  });

  await t.test("a newer release replaces an older staged one even with automatic updates off", async () => {
    const env = await fixture({ autoUpdate: false });
    try {
      env.publish("0.3.7");
      await env.updater.check();
      await env.updater.download({ explicit: true });
      env.publish("0.3.8");
      const status = await env.updater.check();
      assert.equal(status.state, "available");
      assert.equal(status.latestVersion, "0.3.8");
      assert.equal(env.updater.installOnQuit(), false);
    } finally {
      await env.cleanup();
    }
  });

  await t.test("turning automatic updates off cancels a download it started", async () => {
    const env = await fixture({ timeouts: { metadata: 2000, downloadIdle: 5000 } });
    try {
      const { archiveUrl } = env.publish("0.3.7");
      env.stalled.add(archiveUrl);
      await env.updater.check();
      await env.waitFor("downloading");
      env.updater.setAutoUpdate(false);
      await env.waitFor("available");
      assert.equal(env.updater.installOnQuit(), false);
      assert.deepEqual(await env.stagedApps(), []);
    } finally {
      await env.cleanup();
    }
  });
});

// Time limits make a missing timeout fail fast instead of hanging the suite.
test("stalled requests time out instead of blocking updates until restart", { timeout: 15000 }, async () => {
  const env = await fixture({ timeouts: { metadata: 60, downloadIdle: 60 } });
  try {
    const { archiveUrl } = env.publish("0.3.7");
    env.stalled.add(LATEST_RELEASE_URL);
    const stalledCheck = await env.updater.check();
    assert.equal(stalledCheck.state, "error");
    assert.match(stalledCheck.error, /did not respond in time/);
    env.stalled.delete(LATEST_RELEASE_URL);
    env.stalled.add(archiveUrl);
    await env.updater.check();
    await env.waitFor("error");
    assert.match(env.updater.getStatus().error, /stalled/);
    env.stalled.delete(archiveUrl);
    await env.updater.check();
    await env.waitFor("ready");
  } finally {
    await env.cleanup();
  }
});

test("only a real GitHub rate limit is reported as one", async () => {
  const env = await fixture();
  try {
    const answer = (status, headers) => createUpdater({ ...env.options, fetch: async () => new Response("{}", { status, headers }) }).check();
    assert.match((await answer(403, { "x-ratelimit-remaining": "0" })).error, /rate limiting/);
    assert.match((await answer(429, {})).error, /rate limiting/);
    assert.equal((await answer(403, { "x-ratelimit-remaining": "59" })).error, "GitHub answered HTTP 403.");
  } finally {
    await env.cleanup();
  }
});

test("an up-to-date app downloads nothing", async () => {
  const env = await fixture();
  try {
    env.publish("0.3.0");
    assert.equal((await env.updater.check()).state, "up-to-date");
    assert.deepEqual(env.requests, [LATEST_RELEASE_URL]);
  } finally {
    await env.cleanup();
  }
});

test("a tampered manifest, or one signed with another key, is refused before any download", async () => {
  for (const options of [{}, { publicKey: keyPair().publicPem }]) {
    const env = await fixture(options);
    try {
      env.publish("0.3.7", { tamperManifest: !options.publicKey });
      const status = await env.updater.check();
      assert.equal(status.state, "error");
      assert.match(status.error, /signature is not valid/);
      assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
    } finally {
      await env.cleanup();
    }
  }
});

test("an archive that does not match the signed checksum is discarded and the app is untouched", async () => {
  const env = await fixture();
  try {
    env.publish("0.3.7", { servedArchive: randomBytes(64 * 1024) });
    await env.updater.check();
    await env.waitFor("error");
    assert.match(env.updater.getStatus().error, /integrity check/);
    assert.equal(env.updater.installOnQuit(), false);
    assert.equal(await env.installed(), "SoftConnect 0.3.0");
    assert.deepEqual(await env.stagedApps(), []);
  } finally {
    await env.cleanup();
  }
});

test("downloads outside this repository's releases are refused", async () => {
  const env = await fixture();
  try {
    env.publish("0.3.7", { mutateRelease: (release) => { release.assets[0].browser_download_url = "https://example.com/SoftConnect-0.3.7-mac-arm64.zip"; } });
    const status = await env.updater.check();
    assert.equal(status.state, "error");
    assert.match(status.error, /missing SoftConnect-0\.3\.7-mac-arm64\.zip/);
  } finally {
    await env.cleanup();
  }
});

test("a release that fails verification is not downloaded again automatically", async () => {
  for (const options of [{ bundleVersion: "0.3.6" }, { symlinkBundle: true }]) {
    const env = await fixture();
    try {
      env.publish("0.3.7", options);
      await env.updater.check();
      await env.waitFor("error");
      assert.match(env.updater.getStatus().error, options.symlinkBundle ? /does not contain SoftConnect\.app/ : /does not match the expected bundle or version/);
      assert.deepEqual(await env.stagedApps(), []);
      const downloads = () => env.requests.filter((url) => url.endsWith(".zip")).length;
      const before = downloads();
      const again = await env.updater.check();
      assert.equal(again.state, "available");
      assert.match(again.notice, /failed verification before/);
      assert.equal(downloads(), before, "no automatic retry");
      await env.updater.download({ explicit: true });
      assert.equal(downloads(), before + 1, "an explicit retry is still possible");
    } finally {
      await env.cleanup();
    }
  }
});

test("a failed swap puts the original app back", async () => {
  let sabotage = null;
  // Runs after every pre-install check has passed and just before the renames.
  const wrapTools = (tools) => ({ ...tools, versionSync: (app) => {
    const version = tools.versionSync(app);
    if (sabotage && !app.includes(STAGING_NAME)) sabotage();
    return version;
  } });
  const env = await fixture({ wrapTools });
  try {
    env.publish("0.3.7");
    await env.updater.check();
    await env.waitFor("ready");
    const [folder] = await env.stagedApps();
    const staged = join(env.applications, STAGING_NAME, folder, "SoftConnect.app");
    sabotage = () => { sabotage = null; renameSync(staged, join(env.root, "moved.app")); };
    assert.equal(env.updater.installNow(), false);
    assert.match(env.updater.getStatus().error, /Couldn't install the update/);
    assert.equal(await env.installed(), "SoftConnect 0.3.0");
  } finally {
    await env.cleanup();
  }
});

test("with automatic updates off, a new version is announced but only downloaded on request", async () => {
  const env = await fixture({ autoUpdate: false });
  try {
    env.publish("0.3.7");
    assert.equal((await env.updater.check()).state, "available");
    assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
    assert.equal((await env.updater.download({ explicit: true })).state, "ready");
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
      env.publish("0.3.7");
      const status = await env.updater.check();
      assert.equal(status.state, "available");
      assert.equal(status.canInstall, false);
      assert.match(status.installBlockedReason, reason);
      assert.equal((await env.updater.download({ explicit: true })).state, "available");
      assert.equal(env.requests.some((url) => url.endsWith(".zip")), false);
    } finally {
      await env.cleanup();
    }
  }
});
