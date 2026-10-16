"use strict";

const assert = require("node:assert/strict");
const { chmod, mkdtemp, readFile, rm, symlink, unlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { createNativeService, parseClientList, parseClientStateXml, parseServerProcesses } = require("../electron/native.cjs");

const LIST = `VirtualHere IPC, below are the available devices:
(Value in brackets = address, * = Auto-Use)

Studio Hub (studio:7575)
  --> USB Audio (studio.11)
  *--> Security Key (studio.12) In-use by you
Workshop Hub (workshop:7575)
  --> Serial Cable (workshop.21) In-use by: another client

Auto-Find currently on
Auto-Use All currently off
`;

test("LIST parser keeps hubs, device ownership and client flags", () => {
  const state = parseClientList(LIST);
  assert.equal(state.servers.length, 2);
  assert.equal(state.servers[0].devices[0].inUse, false);
  assert.equal(state.servers[0].devices[1].localUse, true);
  assert.equal(state.servers[0].devices[1].autoUse, true);
  assert.equal(state.servers[1].devices[0].inUse, true);
  assert.equal(state.servers[1].devices[0].localUse, false);
  assert.equal(state.flags["auto-find"], true);
  assert.equal(state.flags["auto-use-all"], false);
});

test("LIST parser keeps parenthetical names and ignores addresses in owner details", () => {
  const list = `VirtualHere Client IPC, below are the available devices:
Studio Hub (studio:7575)
  --> Audio DAC (MK II) (studio.11) (In-use by:Jane (Jane) at 192.168.1.15)
  *--> (COM3,COM4) Serial Adapter (studio.12) (In-use by you)
`;
  const devices = parseClientList(list).servers[0].devices;
  assert.deepEqual(devices.map(({ name, address }) => ({ name, address })), [
    { name: "Audio DAC (MK II)", address: "studio.11" },
    { name: "(COM3,COM4) Serial Adapter", address: "studio.12" },
  ]);
  assert.equal(devices[0].inUse, true);
  assert.equal(devices[0].localUse, false);
  assert.equal(devices[1].localUse, true);
});

test("LIST parser reports who holds a device in use elsewhere", () => {
  const list = `VirtualHere Client IPC, below are the available devices:
Studio Hub (studio:7575)
  --> Audio DAC (MK II) (studio.11) (In-use by:Jane (Jane) at 192.168.1.15)
  --> Serial Cable (studio.12) In-use by: another client
  --> Security Key (studio.13) (In-use by you)
  --> Webcam (studio.14)
`;
  const owners = parseClientList(list).servers[0].devices.map((device) => device.owner);
  assert.deepEqual(owners, ["Jane (Jane) at 192.168.1.15", "another client", null, null]);
});

test("server process detection requires the installed executable, not a matching argument", () => {
  const app = "/Applications/VirtualHereServerUniversal.app";
  const executable = `${app}/Contents/MacOS/vhusbdosx`;
  assert.equal(parseServerProcesses(`234 /bin/sh -c ${executable}\n`, app), false);
  assert.equal(parseServerProcesses(`61739 ${executable} -b\n`, app), true);
  assert.equal(parseServerProcesses("61739 /tmp/vhusbdosx -b\n", app), false);
});

test("GET CLIENT STATE XML preserves unknown elements and attributes", () => {
  const state = parseClientStateXml('<client-state revision="6"><connection state="3"><device address="studio.11" state="3" boundTime="2026-10-15T19:20:00Z" future="kept"/></connection></client-state>');
  assert.equal(state.parseError, null);
  assert.equal(state.document["client-state"]["@attributes"].revision, "6");
  assert.equal(state.document["client-state"].connection.device["@attributes"].future, "kept");
  assert.equal(parseClientStateXml('<!DOCTYPE client-state><client-state/>').document, null);
});

test("documented client IPC adapter uses only selected mock executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-client-fixture-"));
  const client = join(root, "mock-client.cjs");
  const calls = join(root, "calls.jsonl");
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[3];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({flag:process.argv[2],command})+'\\n');
if (command === 'LIST') process.stdout.write(${JSON.stringify(LIST)});
else if (command === 'GET CLIENT STATE') process.stdout.write('<client-state/>\\n');
else if (command === 'USE,studio.11') process.stdout.write('OK\\n');
else { process.stdout.write('FAILED\\n'); process.exitCode = 1; }
`;
  try {
    await writeFile(client, fixture);
    await chmod(client, 0o700);
    const service = createNativeService({ clientPaths: [client], serverPaths: [] });
    const state = await service.getState();
    assert.equal(state.available, true);
    assert.equal(state.servers[0].devices[0].address, "studio.11");
    assert.deepEqual((await service.getDetailedState()).document, { "client-state": "" });
    assert.equal((await service.sendCommand({ action: "use", target: "studio.11" })).reply, "OK");
    const before = (await readFile(calls, "utf8")).trim().split("\n");
    await assert.rejects(() => service.sendCommand({ action: "use", target: "studio.11,STOP USING ALL" }), /Invalid target/);
    assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), before);
    assert.deepEqual(before.map((line) => JSON.parse(line)), [
      { flag: "-t", command: "LIST" },
      { flag: "-t", command: "GET CLIENT STATE" },
      { flag: "-t", command: "USE,studio.11" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read polls coalesce and client commands run serially with fresh state afterward", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-queue-fixture-"));
  const client = join(root, "mock-client.cjs");
  const calls = join(root, "calls.jsonl");
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[3];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({phase:'start',command})+'\\n');
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({phase:'end',command})+'\\n');
  process.stdout.write(command === 'LIST' ? ${JSON.stringify(LIST)} : 'OK\\n');
}, 100);
`;
  try {
    await writeFile(client, fixture);
    await chmod(client, 0o700);
    const service = createNativeService({ clientPaths: [client], serverPaths: [] });
    const first = await Promise.all([service.getState(), service.getState(), service.getState()]);
    assert.equal(first.every((state) => state.available && state.servers.length === 2), true);
    await service.getState();
    const command = service.sendCommand({ action: "use", target: "studio.11" });
    const refreshed = service.getState();
    assert.equal((await command).reply, "OK");
    assert.equal((await refreshed).available, true);
    const callsSeen = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(callsSeen, [
      { phase: "start", command: "LIST" },
      { phase: "end", command: "LIST" },
      { phase: "start", command: "USE,studio.11" },
      { phase: "end", command: "USE,studio.11" },
      { phase: "start", command: "LIST" },
      { phase: "end", command: "LIST" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot returns status and state in one call and rediscovers a removed client", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-snapshot-fixture-"));
  const client = join(root, "mock-client.cjs");
  try {
    await writeFile(client, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(LIST)});\n`);
    await chmod(client, 0o700);
    const service = createNativeService({ clientPaths: [client], serverPaths: [] });
    const snapshot = await service.getSnapshot();
    assert.deepEqual(snapshot.status, { paths: { client, serverApp: null }, server: { installed: false, running: false } });
    assert.equal(snapshot.state.available, true);
    assert.equal(snapshot.state.servers.length, 2);

    // The cached path now points at a missing file: the failed spawn triggers discovery in the same read.
    await unlink(client);
    await new Promise((resolve) => setTimeout(resolve, 800)); // outlive the 750 ms read cache
    const removed = await service.getState();
    assert.equal(removed.available, false);
    assert.match(removed.reason, /Install and launch/);

    // A fresh snapshot skips the read cache that would otherwise answer within 750 ms.
    await writeFile(client, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(LIST)});\n`);
    await chmod(client, 0o700);
    assert.equal((await service.getSnapshot()).state.available, true);
    await unlink(client);
    assert.equal((await service.getSnapshot()).state.available, true, "cached read within 750 ms");
    assert.match((await service.getSnapshot({ fresh: true })).state.reason, /Install and launch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("client errors are actionable and malformed success responses are not treated as live state", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-errors-fixture-"));
  const client = join(root, "mock-client.cjs");
  const fixture = `#!/usr/bin/env node
const command = process.argv[3];
if (command === 'LIST') process.stdout.write('IPC ERROR\\n');
else if (command === 'USE,studio.11') process.stdout.write('FAILED\\n');
else if (command === 'STOP USING,studio.11') process.stdout.write('UNKNOWN COMMAND\\n');
else process.stdout.write('\\n');
`;
  try {
    await writeFile(client, fixture);
    await chmod(client, 0o700);
    const service = createNativeService({ clientPaths: [client], serverPaths: [] });
    assert.match((await service.getState()).reason, /client is not running/i);
    assert.match((await service.sendCommand({ action: "use", target: "studio.11" })).reason, /could not complete/i);
    assert.match((await service.sendCommand({ action: "stop", target: "studio.11" })).reason, /unexpected command response/i);
    assert.match((await service.getDetailedState()).reason, /empty response/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS AF_UNIX missing-client response explains that the client must be started", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-unix-ipc-fixture-"));
  const client = join(root, "mock-client.cjs");
  const fixture = `#!/usr/bin/env node
process.stderr.write('IPC client AF_UNIX connect error 2 (No such file or directory). Make sure the client is already running before calling the IPC\\n');
process.exitCode = 2;
`;
  try {
    await writeFile(client, fixture);
    await chmod(client, 0o700);
    const service = createNativeService({ clientPaths: [client], serverPaths: [] });
    const state = await service.getState();
    assert.equal(state.available, false);
    assert.match(state.reason, /client is not running\. Open it and refresh\./);
    assert.deepEqual(state.servers, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing server logs are empty and symbolic links remain rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "softconnect-log-fixture-"));
  const log = join(root, "server.log");
  const link = join(root, "server-link.log");
  try {
    const service = createNativeService({ clientPaths: [], serverPaths: [], logPath: log });
    assert.deepEqual(await service.readServerLog(), { text: "", truncated: false });
    await writeFile(log, "started\n");
    assert.deepEqual(await service.readServerLog(), { text: "started\n", truncated: false });
    await symlink(log, link);
    const linkedService = createNativeService({ clientPaths: [], serverPaths: [], logPath: link });
    await assert.rejects(() => linkedService.readServerLog(), /ELOOP/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
