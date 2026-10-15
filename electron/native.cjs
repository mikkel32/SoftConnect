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
    const device = line.match(/^(\*\s*)?-->\s+(.+?)\s+\(([^()]+)\)(.*)$/);
    if (device && server) {
      const [, autoMarker, name, address, suffix] = device;
      server.devices.push({
        name: name.trim(),
        address: address.trim(),
        inUse: /\bIn[- ]use by\b/i.test(suffix),
        localUse: /\bIn[- ]use by you\b/i.test(suffix),
        autoUse: Boolean(autoMarker) || /\bAuto-Use\b/i.test(suffix),
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
  async function findPaths() {
    const [client, serverApp] = await Promise.all([
      firstAvailable(clientPaths, true),
      firstAvailable(serverPaths),
    ]);
    return { client, serverApp };
  }

  async function queryClient(command) {
    const { client } = await findPaths();
    if (!client) return { available: false, reason: "Install and launch the official VirtualHere client to connect devices" };
    try {
      const result = await run(client, ["-t", command]);
      const reply = result.stdout.trim();
      if (result.code !== 0 || reply === "IPC ERROR" || /^(FAILED|ERROR:)/i.test(reply)) {
        return { available: false, reason: reply || result.stderr.trim() || "The native client did not respond", reply, client };
      }
      return { available: true, reply, client };
    } catch (error) {
      return { available: false, reason: error.message, client };
    }
  }

  async function getState() {
    const result = await queryClient("LIST");
    return {
      ...result,
      ...(result.available ? parseClientList(result.reply) : { servers: [], flags: {} }),
      updatedAt: new Date().toISOString(),
    };
  }

  async function getDetailedState() {
    const result = await queryClient("GET CLIENT STATE");
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
    return queryClient(parts.join(","));
  }

  async function serverStatus() {
    const { serverApp } = await findPaths();
    if (!serverApp) return { installed: false, running: false };
    try {
      const result = await run("/usr/bin/pgrep", ["-fl", "VirtualHereServerUniversal|vhusbdosx"], 3000);
      return { installed: true, running: result.code === 0, serverApp };
    } catch {
      return { installed: true, running: null, serverApp };
    }
  }

  async function getStatus() {
    const [paths, server] = await Promise.all([findPaths(), serverStatus()]);
    return { paths, server };
  }

  async function openApp(which) {
    const paths = await findPaths();
    const selected = which === "client" && paths.client
      ? dirname(dirname(dirname(paths.client)))
      : which === "server" ? paths.serverApp : null;
    if (!selected) throw new Error(`Official ${which} application was not found`);
    const result = await run("/usr/bin/open", ["-a", selected], 6000);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `Could not open the ${which} application`);
    return { opened: true };
  }

  async function readServerLog() {
    const file = await open(logPath, constants.O_RDONLY | constants.O_NOFOLLOW);
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

  return { findPaths, getState, getDetailedState, getStatus, sendCommand, openApp, readServerLog };
}

module.exports = { createNativeService, parseClientList, parseClientStateXml };
