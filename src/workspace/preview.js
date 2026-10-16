// Sample workspace for Preview mode. Commands here only rewrite this data; nothing reaches the native client.

export const sampleServers = [
  {
    name: "Studio workstation",
    address: "studio-demo:7575",
    devices: [
      { name: "USB label printer", address: "studio-demo.11", inUse: true, localUse: true, autoUse: false, owner: null, detail: "In use by this preview" },
      { name: "Portable SSD", address: "studio-demo.12", inUse: false, localUse: false, autoUse: true, owner: null, detail: "" },
      { name: "Security key", address: "studio-demo.13", inUse: false, localUse: false, autoUse: false, owner: null, detail: "" },
    ],
  },
  {
    name: "Workshop hub",
    address: "workshop-demo:7575",
    devices: [
      { name: "USB serial adapter", address: "workshop-demo.21", inUse: false, localUse: false, autoUse: false, owner: null, detail: "" },
      { name: "Barcode scanner", address: "workshop-demo.22", inUse: true, localUse: false, autoUse: false, owner: "another preview client", detail: "" },
    ],
  },
];

function patchDevice(servers, address, change) {
  return servers.map((server) => ({
    ...server,
    devices: server.devices.map((device) => (device.address === address ? { ...device, ...change(device) } : device)),
  }));
}

export function applyPreviewCommand(servers, action, target, value) {
  switch (action) {
    case "use": return patchDevice(servers, target, () => ({ inUse: true, localUse: true, owner: null, detail: "In use by this preview" }));
    case "stop": return patchDevice(servers, target, () => ({ inUse: false, localUse: false, owner: null, detail: "" }));
    case "auto-device": return patchDevice(servers, target, (device) => ({ autoUse: !device.autoUse }));
    case "device-rename": return patchDevice(servers, target, () => ({ name: value }));
    case "manual-add": {
      const address = target.includes(":") ? target : `${target}:7575`;
      if (servers.some((server) => server.address === address)) return servers;
      return [...servers, { name: target.split(":")[0], address, devices: [] }];
    }
    default: return servers;
  }
}

export function previewInfo(servers, action, target) {
  if (action === "server-info") {
    const server = servers.find((candidate) => candidate.name === target || candidate.address === target);
    return `${server?.name || target}\nAddress: ${server?.address || "unknown"}\nShared devices: ${server?.devices.length ?? 0}\nSource: Preview sample`;
  }
  const device = servers.flatMap((server) => server.devices).find((candidate) => candidate.address === target);
  return `${device?.name || target}\nAddress: ${target}\nAuto use: ${device?.autoUse ? "on" : "off"}\nSource: Preview sample`;
}
