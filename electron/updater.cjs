"use strict";

// Self-update for the ad hoc signed macOS build. Squirrel.Mac (Electron's autoUpdater) requires a
// Developer ID signature, so SoftConnect verifies and installs releases itself:
//   1. read this repository's latest GitHub release,
//   2. verify the release's update manifest against the Ed25519 public key shipped in the app,
//   3. download the archive for this Mac and check its size and SHA-256 against the manifest,
//   4. unpack it next to the installed app and check bundle id, version and code signature,
//   5. swap the bundles with two same-volume renames when the app quits or restarts.

const { createHash, createPublicKey, verify: verifySignature } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { dirname, join } = require("node:path");

const REPOSITORY = "mikkel32/SoftConnect";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_PAGE_PREFIX = `https://github.com/${REPOSITORY}/releases/`;
const DOWNLOAD_PREFIX = `${RELEASE_PAGE_PREFIX}download/`;
const MANIFEST_NAME = "softconnect-update.json";
const SIGNATURE_NAME = `${MANIFEST_NAME}.sig`;
const BUNDLE_ID = "app.softconnect.desktop";
const BUNDLE_NAME = "SoftConnect.app";
// Staged beside the installed app so the final swap is a rename on the same volume.
const STAGING_NAME = ".SoftConnect-update";
const ARCHIVE_NAME = /^SoftConnect-(\d+\.\d+\.\d+)-mac-(arm64|x64)\.zip$/;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_ARCHIVE_BYTES = 600 * 1024 * 1024;
const MAX_NOTES_LENGTH = 4000;
const FIRST_CHECK_DELAY_MS = 15000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PROGRESS_INTERVAL_MS = 200;
const NO_KEY_REASON = "This build has no update signing key, so it cannot verify or install updates.";

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("The update manifest is malformed");
  if (manifest.bundleId !== BUNDLE_ID) throw new Error("The update manifest is for a different app");
  if (!parseVersion(manifest.version)) throw new Error("The update manifest has no valid version");
  if (!manifest.archives || typeof manifest.archives !== "object") throw new Error("The update manifest lists no archives");
  for (const [arch, archive] of Object.entries(manifest.archives)) {
    const name = ARCHIVE_NAME.exec(archive?.name || "");
    const valid = name && name[1] === manifest.version && name[2] === arch
      && Number.isSafeInteger(archive.size) && archive.size > 0 && archive.size <= MAX_ARCHIVE_BYTES
      && /^[0-9a-f]{64}$/.test(archive.sha256 || "");
    if (!valid) throw new Error("The update manifest lists an invalid archive");
  }
  if (manifest.notes !== undefined && typeof manifest.notes !== "string") throw new Error("The update manifest has invalid notes");
  return manifest;
}

// The signature covers the exact manifest bytes, so nothing in the manifest is trusted before this passes.
function verifyManifest(bytes, signatureText, publicKeyPem) {
  const signature = Buffer.from(String(signatureText).trim(), "base64");
  let valid = false;
  try {
    valid = signature.length === 64 && verifySignature(null, bytes, createPublicKey(publicKeyPem), signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("The update's signature is not valid");
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("The update manifest is not valid JSON");
  }
  return validateManifest(manifest);
}

function installTarget({ platform, packaged, execPath }) {
  if (platform !== "darwin") return { reason: "Automatic updates are available in the macOS app." };
  if (!packaged) return { reason: "Updates install into the packaged app, not development builds." };
  const bundle = dirname(dirname(dirname(execPath)));
  if (!bundle.endsWith(".app")) return { reason: "SoftConnect is not running from an app bundle." };
  if (bundle.includes("/AppTranslocation/")) {
    return { reason: "Move SoftConnect to your Applications folder to turn on automatic updates." };
  }
  return { bundle };
}

function friendlyError(error) {
  const message = error?.message || String(error);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return "You appear to be offline.";
  return message;
}

function memoryPreferences(initial = {}) {
  let value = { ...initial };
  return { load: () => ({ ...value }), save: (next) => { value = { ...next }; } };
}

function filePreferences(path) {
  return {
    load() {
      try {
        const value = JSON.parse(fs.readFileSync(path, "utf8"));
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    },
    save(value) {
      try {
        fs.mkdirSync(dirname(path), { recursive: true });
        fs.writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
      } catch {
        // Preferences are a convenience; updates still work with defaults.
      }
    },
  };
}

// macOS tools used for staging; tests substitute these.
function macTools(run) {
  async function succeed(executable, args, timeoutMs, failure) {
    const result = await run(executable, args, timeoutMs);
    if (result.code !== 0) throw new Error(`${failure}: ${result.stderr.trim() || `exit code ${result.code}`}`);
    return result;
  }
  return {
    extract: (archive, directory) => succeed("/usr/bin/ditto", ["-x", "-k", archive, directory], 180000, "Couldn't unpack the update"),
    bundleInfo: async (app) => JSON.parse((await succeed("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")], 10000, "Couldn't read the update's Info.plist")).stdout),
    verifySignature: (app) => succeed("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], 120000, "The update's code signature is invalid"),
  };
}

function createUpdater({
  currentVersion,
  publicKey,
  fetch: fetchImpl,
  tools,
  tempDir,
  platform = process.platform,
  arch = process.arch,
  packaged = false,
  execPath = process.execPath,
  preferences = memoryPreferences(),
  onStatus = () => {},
  now = Date.now,
  autoCheck = packaged && Boolean(publicKey),
}) {
  const target = installTarget({ platform, packaged, execPath });
  // Reasons that hold for the whole run; writability is re-checked before every update check.
  const fixedReason = target.reason || (publicKey ? null : NO_KEY_REASON);
  let prefs = preferences.load();
  let blockedReason = fixedReason;
  let release = null;
  let staged = null;
  let checking = null;
  let downloading = null;
  let timers = [];
  let status = {
    state: "idle",
    currentVersion,
    autoUpdate: prefs.autoUpdate !== false,
    canInstall: !blockedReason,
    installBlockedReason: blockedReason,
    latestVersion: null,
    notes: "",
    releaseUrl: null,
    progress: 0,
    checkedAt: null,
    error: null,
    updatedFrom: null,
  };

  function getStatus() {
    return { ...status };
  }

  function set(changes) {
    status = { ...status, ...changes };
    onStatus(getStatus());
  }

  function savePrefs(next) {
    prefs = next;
    preferences.save(prefs);
  }

  const headers = (accept) => ({ Accept: accept, "Cache-Control": "no-cache", "User-Agent": `SoftConnect/${currentVersion}` });

  async function fetchBytes(url, accept, limit) {
    const response = await fetchImpl(url, { headers: headers(accept) });
    if (!response.ok) {
      if (response.status === 404) throw new Error("No stable release has been published yet.");
      if (response.status === 403 || response.status === 429) throw new Error("GitHub is rate limiting update checks. SoftConnect will try again later.");
      throw new Error(`GitHub answered HTTP ${response.status}.`);
    }
    if (Number(response.headers.get("content-length") || 0) > limit) throw new Error("The update metadata is unexpectedly large.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error("The update metadata is unexpectedly large.");
    return bytes;
  }

  function assetUrl(releaseJson, name) {
    const asset = Array.isArray(releaseJson.assets) ? releaseJson.assets.find((candidate) => candidate?.name === name) : null;
    const url = asset?.browser_download_url;
    return typeof url === "string" && url.toLowerCase().startsWith(DOWNLOAD_PREFIX.toLowerCase()) ? url : null;
  }

  async function refreshWritable() {
    if (fixedReason) return;
    try {
      await fsp.access(dirname(target.bundle), fs.constants.W_OK);
      await fsp.access(target.bundle, fs.constants.W_OK);
      blockedReason = null;
    } catch {
      blockedReason = `SoftConnect can't replace itself in ${dirname(target.bundle)}. Move it to your Applications folder to turn on automatic updates.`;
    }
    set({ canInstall: !blockedReason, installBlockedReason: blockedReason });
  }

  async function runCheck() {
    set({ state: "checking", error: null });
    try {
      await refreshWritable();
      const releaseJson = JSON.parse((await fetchBytes(LATEST_RELEASE_URL, "application/vnd.github+json", MAX_METADATA_BYTES)).toString("utf8"));
      const version = String(releaseJson.tag_name || "").replace(/^v/, "");
      if (!parseVersion(version)) throw new Error("The latest release has no valid version tag.");
      const releaseUrl = typeof releaseJson.html_url === "string" && releaseJson.html_url.toLowerCase().startsWith(RELEASE_PAGE_PREFIX.toLowerCase())
        ? releaseJson.html_url
        : null;
      if (!isNewer(version, currentVersion)) {
        release = null;
        set({ state: "up-to-date", latestVersion: version, notes: "", releaseUrl, checkedAt: now() });
        return getStatus();
      }
      if (staged?.version === version) {
        set({ state: "ready", latestVersion: version, releaseUrl, checkedAt: now() });
        return getStatus();
      }
      if (!publicKey) {
        release = null;
        set({ state: "available", latestVersion: version, notes: "", releaseUrl, checkedAt: now(), canInstall: false, installBlockedReason: NO_KEY_REASON });
        return getStatus();
      }
      const manifestUrl = assetUrl(releaseJson, MANIFEST_NAME);
      const signatureUrl = assetUrl(releaseJson, SIGNATURE_NAME);
      if (!manifestUrl || !signatureUrl) throw new Error(`Release ${version} has no signed update manifest.`);
      const [manifestBytes, signatureBytes] = await Promise.all([
        fetchBytes(manifestUrl, "application/octet-stream", MAX_METADATA_BYTES),
        fetchBytes(signatureUrl, "application/octet-stream", MAX_SIGNATURE_BYTES),
      ]);
      const manifest = verifyManifest(manifestBytes, signatureBytes.toString("utf8"), publicKey);
      if (manifest.version !== version) throw new Error("The update manifest does not match the release tag.");
      const notes = (manifest.notes || "").slice(0, MAX_NOTES_LENGTH);
      const archive = manifest.archives[arch];
      const archiveUrl = archive && assetUrl(releaseJson, archive.name);
      if (archive && !archiveUrl) throw new Error(`Release ${version} is missing ${archive.name}.`);
      release = archive ? { version, archive, archiveUrl } : null;
      set({
        state: "available",
        latestVersion: version,
        notes,
        releaseUrl,
        checkedAt: now(),
        progress: 0,
        canInstall: Boolean(release) && !blockedReason,
        installBlockedReason: release ? blockedReason : `Version ${version} has no build for this Mac (${arch}).`,
      });
    } catch (error) {
      set({ state: "error", error: friendlyError(error), checkedAt: now() });
    }
    return getStatus();
  }

  function check() {
    if (downloading) return Promise.resolve(getStatus());
    if (!checking) {
      checking = runCheck().then((result) => {
        if (result.state === "available" && status.autoUpdate && status.canInstall) download();
        return getStatus();
      }).finally(() => { checking = null; });
    }
    return checking;
  }

  async function downloadArchive({ archive, archiveUrl }, destination) {
    const response = await fetchImpl(archiveUrl, { headers: headers("application/octet-stream") });
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status}).`);
    const hash = createHash("sha256");
    const file = await fsp.open(destination, "wx", 0o600);
    let received = 0;
    let reportedAt = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        if (received > archive.size) throw new Error("The update download is larger than expected.");
        hash.update(chunk);
        await file.write(chunk);
        if (now() - reportedAt >= PROGRESS_INTERVAL_MS) {
          reportedAt = now();
          set({ progress: received / archive.size });
        }
      }
    } finally {
      await file.close();
    }
    if (received !== archive.size || hash.digest("hex") !== archive.sha256) throw new Error("The update download failed its integrity check.");
  }

  async function stage(archivePath, version) {
    const staging = join(dirname(target.bundle), STAGING_NAME);
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { mode: 0o700 });
    await tools.extract(archivePath, staging);
    const app = join(staging, BUNDLE_NAME);
    const info = await fsp.stat(app).catch(() => null);
    if (!info?.isDirectory()) throw new Error("The update archive does not contain SoftConnect.app.");
    const plist = await tools.bundleInfo(app);
    if (plist?.CFBundleIdentifier !== BUNDLE_ID || plist?.CFBundleShortVersionString !== version) {
      throw new Error("The downloaded app does not match the expected bundle or version.");
    }
    await tools.verifySignature(app);
    return { staging, app, version };
  }

  function download() {
    if (downloading) return downloading;
    if (!release || !status.canInstall) return Promise.resolve(getStatus());
    const current = release;
    downloading = (async () => {
      const workDir = join(tempDir, "softconnect-update");
      try {
        await fsp.rm(workDir, { recursive: true, force: true });
        await fsp.mkdir(workDir, { recursive: true, mode: 0o700 });
        set({ state: "downloading", progress: 0, error: null });
        const archivePath = join(workDir, current.archive.name);
        await downloadArchive(current, archivePath);
        set({ state: "verifying", progress: 1 });
        staged = await stage(archivePath, current.version);
        set({ state: "ready", progress: 1 });
      } catch (error) {
        staged = null;
        if (target.bundle) await fsp.rm(join(dirname(target.bundle), STAGING_NAME), { recursive: true, force: true }).catch(() => {});
        set({ state: "error", error: friendlyError(error) });
      } finally {
        await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
        downloading = null;
      }
      return getStatus();
    })();
    return downloading;
  }

  // Synchronous so it can run inside will-quit. Two renames; the second is rolled back if it fails.
  function installStaged() {
    if (!staged) return false;
    const { staging, app, version } = staged;
    const backup = join(staging, "SoftConnect-previous.app");
    fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(target.bundle, backup);
    try {
      fs.renameSync(app, target.bundle);
    } catch (error) {
      fs.renameSync(backup, target.bundle);
      throw error;
    }
    staged = null;
    savePrefs({ ...prefs, pendingInstall: { from: currentVersion, to: version } });
    set({ state: "installed" });
    return true;
  }

  function installNow() {
    try {
      return installStaged();
    } catch (error) {
      staged = null;
      set({ state: "error", error: `Couldn't install the update: ${friendlyError(error)}` });
      return false;
    }
  }

  function installOnQuit() {
    return staged ? installNow() : false;
  }

  function setAutoUpdate(enabled) {
    savePrefs({ ...prefs, autoUpdate: Boolean(enabled) });
    set({ autoUpdate: Boolean(enabled) });
    if (enabled && status.state === "available" && status.canInstall) download();
    return getStatus();
  }

  async function start() {
    // Leftovers from an earlier run (an installed update's backup, or an unfinished download).
    if (target.bundle) await fsp.rm(join(dirname(target.bundle), STAGING_NAME), { recursive: true, force: true }).catch(() => {});
    if (prefs.pendingInstall) {
      if (prefs.pendingInstall.to === currentVersion) set({ updatedFrom: prefs.pendingInstall.from });
      const { pendingInstall: _done, ...rest } = prefs;
      savePrefs(rest);
    }
    await refreshWritable();
    if (!autoCheck) return;
    const first = setTimeout(() => {
      check();
      const repeat = setInterval(check, CHECK_INTERVAL_MS);
      repeat.unref?.();
      timers.push(repeat);
    }, FIRST_CHECK_DELAY_MS);
    first.unref?.();
    timers.push(first);
  }

  function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  return {
    getStatus,
    check,
    download,
    installNow,
    installOnQuit,
    setAutoUpdate,
    releasePage: () => status.releaseUrl,
    start,
    stop,
  };
}

module.exports = {
  BUNDLE_ID,
  DOWNLOAD_PREFIX,
  LATEST_RELEASE_URL,
  MANIFEST_NAME,
  SIGNATURE_NAME,
  STAGING_NAME,
  createUpdater,
  filePreferences,
  isNewer,
  macTools,
  memoryPreferences,
  verifyManifest,
};
