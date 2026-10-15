"use strict";

const assert = require("node:assert/strict");
const { chmod, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { createNativeService, parseClientList, parseClientStateXml } = require("../electron/native.cjs");

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
