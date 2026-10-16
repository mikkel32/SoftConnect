// Pure view-model helpers shared by the workspace hook and the views. No React here, so it is unit tested.

export const VIEWS = [
  { id: "overview", label: "Overview", icon: "grid", shortcut: "1" },
  { id: "devices", label: "Devices", icon: "usb", shortcut: "2" },
  { id: "connections", label: "Connections", icon: "link", shortcut: "3" },
  { id: "activity", label: "Activity", icon: "pulse", shortcut: "4" },
];
export const SETTINGS_VIEW = { id: "settings", label: "Settings", icon: "sliders", shortcut: "," };
export const VIEW_IDS = [...VIEWS.map((view) => view.id), SETTINGS_VIEW.id];

// One place for every "which state is the app in" label instead of nested ternaries per component.
export const MODES = {
  preview: { tone: "sample", chip: "Preview data", title: "Preview workspace", detail: "Sample data only", status: "Preview data" },
  live: { tone: "online", chip: "Live", title: "Native client ready", detail: "Local VirtualHere client", status: "Native client connected" },
  checking: { tone: "checking", chip: "Checking", title: "Checking client", detail: "Reading local components", status: "Checking local client" },
  offline: { tone: "offline", chip: "Client offline", title: "Client not running", detail: "Open the VirtualHere client", status: "Native client offline" },
  unavailable: { tone: "offline", chip: "No desktop bridge", title: "Desktop bridge missing", detail: "Run SoftConnect as the macOS app", status: "Desktop bridge unavailable" },
};

export const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "available", label: "Available", test: (device) => !device.inUse },
  { id: "connected", label: "Connected", test: (device) => Boolean(device.localUse) },
  { id: "occupied", label: "In use", test: (device) => Boolean(device.inUse && !device.localUse) },
];

// Actions that change ownership and are confirmed by re-reading LIST.
export const OWNERSHIP_ACTIONS = new Set(["use", "stop"]);
export const INFO_ACTIONS = new Set(["device-info", "server-info"]);

export function deviceIcon(name = "") {
  const text = name.toLowerCase();
  if (/(audio|speaker|microphone|interface|dac|scarlett)/.test(text)) return "audio";
  if (/(ssd|drive|disk|storage)/.test(text)) return "drive";
  if (/(key|token|security|yubi)/.test(text)) return "lock";
  if (/(printer|label)/.test(text)) return "printer";
  if (/(camera|webcam|brio)/.test(text)) return "camera";
  if (/(serial|uart|ftdi)/.test(text)) return "terminal";
  return "usb";
}

export function deviceState(device, pendingAction) {
  if (pendingAction === "use") return { key: "pending", label: "Connecting…" };
  if (pendingAction === "stop") return { key: "pending", label: "Releasing…" };
  if (device.localUse) return { key: "connected", label: "Connected here" };
  if (device.inUse) return { key: "occupied", label: "In use elsewhere" };
  return { key: "available", label: "Available" };
}

export function ownerLabel(device) {
  if (device.owner) return `Used by ${device.owner}`;
  // Older bridges send only the raw note, e.g. "(In-use by:Jane at 10.0.0.4)".
  const note = (device.detail || "").trim().replace(/^\((.*)\)$/, "$1");
  const owner = note.match(/\bIn[- ]use by:?\s*(.+)$/i)?.[1]?.trim();
  return owner ? `Used by ${owner}` : "Used by another client";
}

export function flattenDevices(servers) {
  return servers.flatMap((server) => (server.devices || []).map((device) => ({ ...device, serverName: server.name, serverAddress: server.address })));
}

export function groupDevices(devices) {
  const groups = { available: [], connected: [], remote: [] };
  for (const device of devices) {
    if (device.localUse) groups.connected.push(device);
    else if (device.inUse) groups.remote.push(device);
    else groups.available.push(device);
  }
  return groups;
}

export function countByFilter(devices) {
  return Object.fromEntries(FILTERS.map((filter) => [filter.id, devices.filter(filter.test).length]));
}

export function filterServers(servers, query, filterId) {
  const test = (FILTERS.find((filter) => filter.id === filterId) || FILTERS[0]).test;
  const needle = query.trim().toLowerCase();
  const result = [];
  for (const server of servers) {
    const serverMatches = Boolean(needle) && `${server.name} ${server.address}`.toLowerCase().includes(needle);
    const devices = (server.devices || []).filter((device) =>
      test(device) && (!needle || serverMatches || `${device.name} ${device.address}`.toLowerCase().includes(needle)));
    if (devices.length || (filterId === "all" && (!needle || serverMatches))) result.push({ ...server, devices });
  }
  return result;
}

export function findDevice(servers, address) {
  for (const server of servers || []) {
    const device = (server.devices || []).find((candidate) => candidate.address === address);
    if (device) return device;
  }
  return null;
}

export function sameClientState(previous, next) {
  // The native timestamp changes on every poll; it does not change the rendered inventory.
  const { updatedAt: _previousUpdatedAt, ...previousData } = previous;
  const { updatedAt: _nextUpdatedAt, ...nextData } = next;
  return JSON.stringify(previousData) === JSON.stringify(nextData);
}

// Mirrors validateField in electron/native.cjs so mistakes are caught before a command is sent.
export function fieldError(value, { allowSpaces = true } = {}) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 160) return "Use 160 characters or fewer.";
  if (trimmed.includes(",")) return "Commas are not allowed by the client API.";
  if (/[\x00-\x1f]/.test(trimmed)) return "Remove control characters.";
  if (!allowSpaces && /\s/.test(trimmed)) return "Server addresses cannot contain spaces.";
  return null;
}
