import assert from "node:assert/strict";
import { test } from "node:test";
import { countByFilter, deviceState, fieldError, filterServers, findDevice, flattenDevices, groupDevices, ownerLabel, sameClientState } from "../src/workspace/model.js";
import { applyPreviewCommand, previewInfo, sampleServers } from "../src/workspace/preview.js";

const servers = [
  { name: "Studio", address: "studio:7575", devices: [
    { name: "Audio DAC", address: "studio.11", inUse: false, localUse: false },
    { name: "Security Key", address: "studio.12", inUse: true, localUse: true },
  ] },
  { name: "Workshop", address: "workshop:7575", devices: [
    { name: "Serial Cable", address: "workshop.21", inUse: true, localUse: false, owner: "Jane at 10.0.0.4" },
  ] },
  { name: "Empty hub", address: "empty:7575", devices: [] },
];

test("devices are grouped by who holds them", () => {
  const groups = groupDevices(flattenDevices(servers));
  assert.deepEqual(groups.available.map((device) => device.address), ["studio.11"]);
  assert.deepEqual(groups.connected.map((device) => device.address), ["studio.12"]);
  assert.deepEqual(groups.remote.map((device) => device.address), ["workshop.21"]);
  assert.equal(groups.connected[0].serverName, "Studio");
  assert.deepEqual(countByFilter(flattenDevices(servers)), { all: 3, available: 1, connected: 1, occupied: 1 });
});

test("search matches device or server text, and filters hide servers without matches", () => {
  assert.deepEqual(filterServers(servers, "", "all").map((server) => server.address), ["studio:7575", "workshop:7575", "empty:7575"]);
  assert.deepEqual(filterServers(servers, "serial", "all").map((server) => server.devices.length), [1]);
  assert.deepEqual(filterServers(servers, "STUDIO", "all")[0].devices.map((device) => device.address), ["studio.11", "studio.12"]);
  assert.deepEqual(filterServers(servers, "", "connected").map((server) => server.address), ["studio:7575"]);
  assert.deepEqual(filterServers(servers, "empty", "all").map((server) => server.address), ["empty:7575"]);
  assert.deepEqual(filterServers(servers, "nothing", "all"), []);
});

test("pending ownership changes are shown instead of the stale state", () => {
  const device = servers[0].devices[0];
  assert.equal(deviceState(device).key, "available");
  assert.deepEqual(deviceState(device, "use"), { key: "pending", label: "Connecting…" });
  assert.deepEqual(deviceState(servers[0].devices[1], "stop"), { key: "pending", label: "Releasing…" });
  assert.equal(deviceState(servers[0].devices[1], "device-rename").key, "connected");
  assert.equal(ownerLabel(servers[1].devices[0]), "Used by Jane at 10.0.0.4");
  assert.equal(ownerLabel({ detail: "(In-use by:Jane (Jane) at 192.168.1.15)" }), "Used by Jane (Jane) at 192.168.1.15");
  assert.equal(ownerLabel({ detail: "" }), "Used by another client");
});

test("field validation mirrors the native validator", () => {
  assert.equal(fieldError(""), null);
  assert.equal(fieldError("Studio DAC"), null);
  assert.match(fieldError("a,b"), /Commas/);
  assert.match(fieldError("x".repeat(161)), /160/);
  assert.match(fieldError("my server", { allowSpaces: false }), /spaces/);
  assert.equal(fieldError("hub.local:7575", { allowSpaces: false }), null);
});

test("state comparison ignores the poll timestamp only", () => {
  const base = { available: true, servers, flags: {}, updatedAt: "a" };
  assert.equal(sameClientState(base, { ...base, updatedAt: "b" }), true);
  assert.equal(sameClientState(base, { ...base, available: false }), false);
  assert.equal(findDevice(servers, "workshop.21").name, "Serial Cable");
  assert.equal(findDevice(servers, "missing"), null);
});

test("preview commands change sample data without mutating it", () => {
  const before = JSON.stringify(sampleServers);
  const connected = applyPreviewCommand(sampleServers, "use", "studio-demo.12");
  assert.equal(findDevice(connected, "studio-demo.12").localUse, true);
  const released = applyPreviewCommand(connected, "stop", "studio-demo.12");
  assert.equal(findDevice(released, "studio-demo.12").inUse, false);
  assert.equal(findDevice(applyPreviewCommand(sampleServers, "auto-device", "studio-demo.12"), "studio-demo.12").autoUse, false);
  assert.equal(findDevice(applyPreviewCommand(sampleServers, "device-rename", "studio-demo.13", "YubiKey"), "studio-demo.13").name, "YubiKey");
  const added = applyPreviewCommand(sampleServers, "manual-add", "lab.local");
  assert.equal(added.at(-1).address, "lab.local:7575");
  assert.equal(applyPreviewCommand(added, "manual-add", "lab.local:7575"), added);
  assert.equal(JSON.stringify(sampleServers), before);
  assert.match(previewInfo(sampleServers, "server-info", "Workshop hub"), /Address: workshop-demo:7575/);
});
