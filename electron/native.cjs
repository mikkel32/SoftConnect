"use strict";

const { spawn } = require("node:child_process");
const { constants } = require("node:fs");
const { access, open, realpath, stat } = require("node:fs/promises");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");
const { XMLParser, XMLValidator } = require("fast-xml-parser");

const CLIENT_PATHS = [
  "/Applications/VirtualHereUniversal.app/Contents/MacOS/VirtualHereUniversal",
  "/Applications/VirtualHere Client.app/Contents/MacOS/VirtualHereUniversal",
  join(homedir(), "Applications/VirtualHereUniversal.app/Contents/MacOS/VirtualHereUniversal"),
];
const SERVER_PATHS = [
  "/Applications/VirtualHereServerUniversal.app",
  join(homedir(), "Applications/VirtualHereServerUniversal.app"),
];
const READ_CACHE_MS = 750;
// Install locations rarely change; re-resolving them on every poll costs several syscalls per read.
const PATH_CACHE_MS = 30000;
// pgrep is a process spawn; the server's running state does not need sub-second freshness.
const SERVER_STATUS_CACHE_MS = 5000;
// Spawn failures mean the process never started, so rediscovering the client and retrying is safe.
const SPAWN_ERRORS = new Set(["ENOENT", "EACCES", "ENOEXEC", "EPERM"]);

const ACTIONS = Object.freeze({
  use: "USE",
  stop: "STOP USING",
  "device-info": "DEVICE INFO",
  "server-info": "SERVER INFO",
  "auto-device": "AUTO USE DEVICE",
  "auto-port": "AUTO USE PORT",
  "auto-device-port": "AUTO USE DEVICE PORT",
  "auto-hub": "AUTO USE HUB",
  "manual-add": "MANUAL HUB ADD",
  "manual-remove": "MANUAL HUB REMOVE",
  "device-rename": "DEVICE RENAME",
  "server-rename": "SERVER RENAME",
});

async function firstAvailable(paths, executable = false) {
  for (const candidate of paths) {
    try {
      const resolved = await realpath(candidate);
      const info = await stat(resolved);
      if (executable ? !info.isFile() : !info.isDirectory()) continue;
      await access(resolved, executable ? constants.X_OK : constants.R_OK);
      return resolved;
    } catch {
      // A candidate installation is optional.
    }
  }
  return null;
}

function run(executable, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stoppedFor = null;
    let escalation;
    let finished = false;
    const timer = setTimeout(() => stop("Native command timed out"), timeoutMs);

    function stop(reason) {
      if (finished || stoppedFor) return;
      stoppedFor = reason;
      child.kill("SIGTERM");
      escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
      escalation.unref();
    }

    function finish(error, code, signal) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      if (error || stoppedFor) return reject(error || new Error(stoppedFor));
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    }

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 262144) stop("Native output exceeded 256 KiB");
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) stop("Native diagnostic exceeded 64 KiB");
      else stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => finish(null, code, signal));
  });
}

function validateField(value, label) {
  if (typeof value !== "string") throw new TypeError(`Invalid ${label}`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || /[,\r\n\0\x00-\x1f]/.test(trimmed)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return trimmed;
}

function parseClientList(reply) {
  const servers = [];
  const flags = {};
  let server = null;
  for (const rawLine of reply.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^VirtualHere (Client|IPC)/i.test(line) || /^\(Value in brackets/i.test(line)) continue;
    const device = line.match(/^(\*\s*)?-->\s+(.+)$/);
    if (device) {
      if (!server) continue;
      const [, autoMarker, body] = device;
      const ownerStart = body.search(/\(In[- ]use by\b/i);
      const addressArea = ownerStart < 0 ? body : body.slice(0, ownerStart);
      const addresses = [...addressArea.matchAll(/\(([^()\s,]+\.[0-9]+(?:\.[0-9]+)*)\)/g)];
      const match = addresses.at(-1);
      if (!match) continue;
      const name = addressArea.slice(0, match.index).trim();
      if (!name) continue;
      const address = match[1];
      const suffix = body.slice(match.index + match[0].length);
      const inUse = /\bIn[- ]use by\b/i.test(suffix);
      const localUse = /\bIn[- ]use by you\b/i.test(suffix);
      server.devices.push({
        name,
        address,
        inUse,
        localUse,
        autoUse: Boolean(autoMarker) || /\bAuto-Use\b/i.test(suffix),
        owner: inUse && !localUse ? parseOwner(suffix) : null,
        detail: suffix.trim(),
      });
      continue;
    }
    const hub = line.match(/^(.+?)\s+\(([^()]+:\d+)\)$/);
    if (hub) {
      server = { name: hub[1].trim(), address: hub[2].trim(), devices: [] };
      servers.push(server);
      continue;
    }
    const flag = line.match(/^(Auto-Find|Auto-Use All|Reverse Lookup|Reverse SSL Lookup) currently (on|off)$/i);
    if (flag) flags[flag[1].toLowerCase().replaceAll(" ", "-")] = flag[2].toLowerCase() === "on";
  }
  return { servers, flags };
}

function parseOwner(suffix) {
  const match = suffix.match(/\bIn[- ]use by:?\s*(.*)$/i);
  if (!match) return null;
  let owner = match[1].trim();
  // The client wraps the whole ownership note in parentheses: "(In-use by:Jane (Jane) at 192.168.1.15)".
  if (suffix.trim().startsWith("(") && owner.endsWith(")")) owner = owner.slice(0, -1).trim();
  return owner || null;
}

function parseServerProcesses(reply, serverApp) {
  const executable = join(serverApp, "Contents/MacOS/vhusbdosx");
  return reply.split(/\r?\n/).some((line) => {
    const command = line.replace(/^\s*\d+\s+/, "").trim();
    return command === executable || command.startsWith(`${executable} `);
  });
}

function clientError(result, reply) {
  if (reply === "IPC ERROR") return "The VirtualHere client is not running. Open it and refresh.";
  if (/IPC client AF_UNIX connect error 2\b/i.test(result.stderr)) {
    return "The VirtualHere client is not running. Open it and refresh.";
  }
  if (/^FAILED$/i.test(reply)) return "The native client could not complete the request. Check device availability and retry.";
  if (/^ERROR:/i.test(reply)) return reply;
  return result.stderr.trim() || reply || `The native client exited with code ${result.code ?? "unknown"}`;
}

function parseClientStateXml(reply) {
  if (/<!DOCTYPE/i.test(reply)) return { document: null, parseError: "Document type declarations are unsupported" };
  const validation = XMLValidator.validate(reply);
  if (validation !== true) return { document: null, parseError: validation.err?.msg || "Invalid client state XML" };
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributesGroupName: "@attributes",
      attributeNamePrefix: "",
      parseAttributeValue: false,
      parseTagValue: false,
      processEntities: false,
      trimValues: false,
    });
    return { document: parser.parse(reply), parseError: null };
  } catch (error) {
    return { document: null, parseError: error.message };
  }
}

function createNativeService({ clientPaths = CLIENT_PATHS, serverPaths = SERVER_PATHS, logPath = join(homedir(), "vhusbd_log.txt") } = {}) {
  let commandTail = Promise.resolve();
  let commandGeneration = 0;
  const pendingReads = new Map();
  const readCache = new Map();
  let pathCache = null;
  let serverStatusCache = null;

  async function findPaths() {
    if (pathCache && pathCache.expiresAt > Date.now()) return pathCache.paths;
    const [client, serverApp] = await Promise.all([
      firstAvailable(clientPaths, true),
      firstAvailable(serverPaths),
    ]);
    const paths = { client, serverApp };
    // Only a found client is cached, so a fresh install is noticed on the next read.
    pathCache = client ? { paths, expiresAt: Date.now() + PATH_CACHE_MS } : null;
    return paths;
  }

  function forgetPaths() {
    pathCache = null;
    serverStatusCache = null;
  }

  async function executeClient(command, requireOk, rediscovered = false) {
    const { client } = await findPaths();
    if (!client) return { available: false, reason: "Install and launch the official VirtualHere client to connect devices" };
    try {
      const result = await run(client, ["-t", command]);
      const reply = result.stdout.trim();
      if (result.code !== 0 || reply === "IPC ERROR" || /^(FAILED|ERROR:)/i.test(reply)) {
        return { available: false, reason: clientError(result, reply), reply, client };
      }
      if (!reply) return { available: false, reason: "The native client returned an empty response", reply, client };
      if (command === "LIST" && !/\bVirtualHere(?: Client)? IPC\b|\bAuto-Find currently (?:on|off)\b/i.test(reply)) {
        return { available: false, reason: "The native client returned an unrecognized device list", reply, client };
      }
      if (requireOk && reply !== "OK") {
        return { available: false, reason: "The native client returned an unexpected command response", reply, client };
      }
      return { available: true, reply, client };
    } catch (error) {
      // The cached client moved or was removed: look again once instead of surfacing a raw spawn error.
      if (SPAWN_ERRORS.has(error.code)) {
        forgetPaths();
        if (!rediscovered) return executeClient(command, requireOk, true);
      }
      return { available: false, reason: error.message, client };
    }
  }

  function queryClient(command, readOnly = false, requireOk = false) {
    if (!readOnly) {
      commandGeneration += 1;
      readCache.clear();
    }
    const generation = commandGeneration;
    const key = `${generation}:${command}`;
    if (readOnly) {
      const cached = readCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result);
      const pending = pendingReads.get(key);
      if (pending) return pending;
    }
    // The client API uses shared IPC endpoints, so only one -t process may run at a time.
    const task = commandTail.then(() => executeClient(command, requireOk));
    commandTail = task.then(() => undefined, () => undefined);
    if (readOnly) {
      pendingReads.set(key, task);
      task.then((result) => {
        if (pendingReads.get(key) === task) pendingReads.delete(key);
        if (generation === commandGeneration && result.available) {
          readCache.set(key, { result, expiresAt: Date.now() + READ_CACHE_MS });
        }
      }, () => {
        if (pendingReads.get(key) === task) pendingReads.delete(key);
      });
    }
    return task;
  }

  async function getState() {
    const result = await queryClient("LIST", true);
    return {
      ...result,
      ...(result.available ? parseClientList(result.reply) : { servers: [], flags: {} }),
      updatedAt: new Date().toISOString(),
    };
  }

  async function getDetailedState() {
    const result = await queryClient("GET CLIENT STATE", true);
    return result.available ? { ...result, ...parseClientStateXml(result.reply) } : { ...result, document: null, parseError: null };
  }

  async function sendCommand(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid command");
    const keys = Object.keys(input);
    if (keys.some((key) => !["action", "target", "value"].includes(key))) throw new TypeError("Unsupported command field");
    const verb = Object.hasOwn(ACTIONS, input.action) ? ACTIONS[input.action] : null;
    if (!verb) throw new TypeError("Unsupported command");
    const parts = [verb, validateField(input.target, "target")];
    if (input.action === "device-rename" || input.action === "server-rename") {
      parts.push(validateField(input.value, "name"));
    } else if (input.value !== undefined) {
      throw new TypeError("This command does not accept a value");
    }
    const requireOk = input.action !== "device-info" && input.action !== "server-info";
    return queryClient(parts.join(","), false, requireOk);
  }

  async function readServerStatus(serverApp) {
    if (!serverApp) return { installed: false, running: false };
    try {
      const result = await run("/usr/bin/pgrep", ["-fl", "VirtualHereServerUniversal|vhusbdosx"], 3000);
      return { installed: true, running: result.code === 0 && parseServerProcesses(result.stdout, serverApp), serverApp };
    } catch {
      return { installed: true, running: null, serverApp };
    }
  }

  function serverStatus(serverApp) {
    const cached = serverStatusCache;
    if (cached && cached.serverApp === serverApp && cached.expiresAt > Date.now()) return cached.task;
    const task = readServerStatus(serverApp);
    serverStatusCache = { serverApp, task, expiresAt: Date.now() + SERVER_STATUS_CACHE_MS };
    return task;
  }

  async function getStatus() {
    const paths = await findPaths();
    const server = await serverStatus(paths.serverApp);
    return { paths, server };
  }

  // One renderer round trip per refresh: installed components and the client's device list.
  // A user-initiated refresh passes fresh to bypass the discovery, process and read caches.
  async function getSnapshot({ fresh = false } = {}) {
    if (fresh) {
      forgetPaths();
      readCache.clear();
    }
    const [status, state] = await Promise.allSettled([getStatus(), getState()]);
    return {
      status: status.status === "fulfilled" ? status.value : null,
      state: state.status === "fulfilled"
        ? state.value
        : { available: false, servers: [], flags: {}, reason: state.reason?.message || "Client state could not be read" },
    };
  }

  async function openApp(which) {
    const paths = await findPaths();
    const selected = which === "client" && paths.client
      ? dirname(dirname(dirname(paths.client)))
      : which === "server" ? paths.serverApp : null;
    if (!selected) throw new Error(`Official ${which} application was not found`);
    forgetPaths();
    const result = await run("/usr/bin/open", ["-a", selected], 6000);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not open the ${which} application`);
    return { opened: true };
  }

  async function readServerLog() {
    let file;
    try {
      file = await open(logPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === "ENOENT") return { text: "", truncated: false };
      throw error;
    }
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error("Server log is not a regular file");
      const length = Math.min(info.size, 65536);
      const buffer = Buffer.alloc(length);
      const result = await file.read(buffer, 0, length, info.size - length);
      return { text: buffer.subarray(0, result.bytesRead).toString("utf8"), truncated: info.size > length };
    } finally {
      await file.close();
    }
  }

  return { findPaths, getState, getDetailedState, getStatus, getSnapshot, sendCommand, openApp, readServerLog };
}

module.exports = { createNativeService, parseClientList, parseClientStateXml, parseServerProcesses };
