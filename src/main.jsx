import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { version as appVersion } from "../package.json";
import logo from "./assets/softconnect-icon.svg";
import "./styles.css";

const bridge = window.softconnect;

const sampleServers = [
  {
    name: "Studio workstation",
    address: "studio-demo:7575",
    devices: [
      { name: "USB label printer", address: "studio-demo.11", inUse: true, localUse: true, autoUse: false, detail: "In use by this preview" },
      { name: "Portable SSD", address: "studio-demo.12", inUse: false, localUse: false, autoUse: true, detail: "" },
      { name: "Security key", address: "studio-demo.13", inUse: false, localUse: false, autoUse: false, detail: "" },
    ],
  },
  {
    name: "Workshop hub",
    address: "workshop-demo:7575",
    devices: [
      { name: "USB serial adapter", address: "workshop-demo.21", inUse: false, localUse: false, autoUse: false, detail: "" },
      { name: "Barcode scanner", address: "workshop-demo.22", inUse: true, localUse: false, autoUse: false, detail: "In use by another preview client" },
    ],
  },
];

const initialStatus = {
  paths: { client: null, serverApp: null },
  server: { installed: false, running: false },
  appVersion,
  platform: "darwin",
};

const emptyServers = [];
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const navItems = [
  ["overview", "Overview", "grid"],
  ["devices", "Devices", "usb"],
  ["connections", "Connections", "link"],
  ["activity", "Activity", "pulse"],
];

const glyphs = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    usb: <><path d="M12 21V4m0 0L9 7m3-3 3 3"/><path d="M12 13H7l-2-2V9m7 7h5l2-2v-2"/><circle cx="5" cy="8" r="1"/><rect x="18" y="9" width="2" height="2" rx=".2"/><circle cx="12" cy="21" r="1"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></>,
    pulse: <><path d="M3 12h4l2.3-6 4.2 12 2.3-6H21"/></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L3 9m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.5L21 15m0 5v-5h-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    down: <path d="m6 9 6 6 6-6"/>,
    close: <path d="M5 5l14 14M19 5 5 19"/>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/></>,
    drive: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18M7 17h.01"/></>,
    audio: <><path d="M5 9v6m3-9v12m3-15v18m3-14v10m3-8v6m3-4v2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    camera: <><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="m8 6 1-2h6l1 2"/></>,
    printer: <><path d="M6 8V3h12v5M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6zM17 11h.01"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    spark: <><path d="m12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Z"/><path d="m19 17 .6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z"/></>,
    external: <><path d="M13 4h7v7m0-7-9 9"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    shield: <><path d="M12 2 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4Z"/><path d="m9 12 2 2 4-4"/></>,
    warning: <><path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>,
};

const Icon = React.memo(function Icon({ name, size = 18, className = "" }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": true };
  return <svg {...props}>{glyphs[name] || glyphs.usb}</svg>;
});

function sameClientState(previous, next) {
  // The native timestamp changes on every poll; it does not change the rendered inventory.
  const { updatedAt: previousUpdatedAt, ...previousData } = previous;
  const { updatedAt: nextUpdatedAt, ...nextData } = next;
  return JSON.stringify(previousData) === JSON.stringify(nextData);
}

function deviceIcon(name) {
  const text = name.toLowerCase();
  if (/(audio|speaker|microphone|interface)/.test(text)) return "audio";
  if (/(ssd|drive|disk|storage)/.test(text)) return "drive";
  if (/(key|token|security)/.test(text)) return "lock";
  if (/(printer|label)/.test(text)) return "printer";
  if (/(camera|webcam)/.test(text)) return "camera";
  if (/(serial|uart)/.test(text)) return "terminal";
  return "usb";
}

function deviceState(device) {
  if (device.localUse) return { key: "connected", label: "Connected here" };
  if (device.inUse) return { key: "occupied", label: "In use elsewhere" };
  return { key: "available", label: "Available" };
}

function Status({ kind = "available", children }) {
  return <span className={`status status-${kind}`}><span className="status-led" aria-hidden="true"/>{children}</span>;
}

function Dialog({ title, children, onClose, footer }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previous?.focus?.(); };
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="dialog-header"><div><span className="eyebrow">SOFTCONNECT</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></header>
      <div className="dialog-content">{children}</div>
      <footer className="dialog-footer">{footer || <button className="button primary" onClick={onClose}>Done</button>}</footer>
    </section>
  </div>;
}

function EmptyState({ icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function App() {
  const refreshInFlight = useRef(null);
  const eventRefreshTimer = useRef(null);
  const clientFollowUpTimer = useRef(null);
  const wasPreview = useRef(false);
  const searchRef = useRef(null);
  const [view, setView] = useState("overview");
  const [preview, setPreview] = useState(false);
  const [sample, setSample] = useState(sampleServers);
  const [nativeStatus, setNativeStatus] = useState(initialStatus);
  const [nativeClient, setNativeClient] = useState({ available: false, servers: [], flags: {}, reason: "Waiting for native client" });
  const [initialized, setInitialized] = useState(!bridge);
  const [syncState, setSyncState] = useState("idle");
  const [lastSync, setLastSync] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [activity, setActivity] = useState([]);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState(null);
  const [formValue, setFormValue] = useState("");

  const client = preview ? { available: true, servers: sample } : nativeClient;
  const servers = Array.isArray(client.servers) ? client.servers : emptyServers;
  const devices = useMemo(() => servers.flatMap((server) => (server.devices || []).map((device) => ({ ...device, serverName: server.name, serverAddress: server.address }))), [servers]);
  const { availableDevices, connectedDevices, remoteDevices } = useMemo(() => ({
    availableDevices: devices.filter((device) => !device.inUse),
    connectedDevices: devices.filter((device) => device.localUse),
    remoteDevices: devices.filter((device) => device.inUse && !device.localUse),
  }), [devices]);
  const featuredDevices = availableDevices.slice(0, 4);
  const searchQuery = useDeferredValue(search.trim().toLowerCase());
  const selectedDevice = devices.find((device) => device.address === selected);
  const selectedServer = servers.find((server) => server.address === selected);
  const liveReady = Boolean(bridge && nativeClient.available);
  const checkingNative = Boolean(bridge && !initialized);

  const record = useCallback((title, detail, kind = "info", isPreview = preview) => {
    setActivity((entries) => [{ id: `${Date.now()}-${Math.random()}`, time: new Date().toISOString(), title, detail, kind, preview: isPreview }, ...entries].slice(0, 40));
  }, [preview]);

  const refresh = useCallback(async (notify = false) => {
    if (!bridge) {
      setSyncState("unavailable");
      setInitialized(true);
      if (notify) setToast("Native desktop bridge is unavailable. Open the macOS app or try Preview.");
      return;
    }
    if (eventRefreshTimer.current) {
      window.clearTimeout(eventRefreshTimer.current);
      eventRefreshTimer.current = null;
    }
    if (notify) setSyncState("syncing");
    if (!refreshInFlight.current) {
      const pending = (async () => {
        const [status, list] = await Promise.allSettled([
          Promise.resolve().then(() => bridge.getStatus()),
          Promise.resolve().then(() => bridge.listDevices()),
        ]);
        if (status.status === "fulfilled") {
          const next = status.value || initialStatus;
          setNativeStatus((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        }
        const nextClient = list.status === "fulfilled"
          ? { servers: [], flags: {}, ...(list.value || {}) }
          : { available: false, servers: [], flags: {}, reason: list.reason?.message || "Client state could not be read" };
        setNativeClient((previous) => sameClientState(previous, nextClient) ? previous : nextClient);
        if (status.status === "fulfilled" || list.status === "fulfilled") {
          const now = new Date();
          setLastSync((previous) => previous && Math.floor(previous.getTime() / 60000) === Math.floor(now.getTime() / 60000) ? previous : now);
        }
        const result = { listOk: list.status === "fulfilled", ok: status.status === "fulfilled" || list.status === "fulfilled" };
        setSyncState(result.ok ? "idle" : "error");
        setInitialized(true);
        return result;
      })();
      refreshInFlight.current = pending;
      pending.then(() => { if (refreshInFlight.current === pending) refreshInFlight.current = null; }, () => { if (refreshInFlight.current === pending) refreshInFlight.current = null; });
    }
    const result = await refreshInFlight.current;
    if (notify) setToast(result.listOk ? "Device inventory refreshed" : "Could not refresh client state");
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!bridge || !autoRefresh || preview) return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, liveReady ? 8000 : 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, liveReady, preview, refresh]);
  useEffect(() => {
    if (!bridge?.onEvent) return undefined;
    const unsubscribe = bridge.onEvent((event) => {
      if (event?.type !== "state-changed" || preview || document.visibilityState !== "visible") return;
      if (eventRefreshTimer.current) window.clearTimeout(eventRefreshTimer.current);
      eventRefreshTimer.current = window.setTimeout(() => { eventRefreshTimer.current = null; refresh(); }, 250);
    });
    return () => { unsubscribe?.(); if (eventRefreshTimer.current) window.clearTimeout(eventRefreshTimer.current); };
  }, [preview, refresh]);
  useEffect(() => {
    if (wasPreview.current && !preview && bridge && document.visibilityState === "visible") refresh();
    wasPreview.current = preview;
  }, [preview, refresh]);
  useEffect(() => {
    if (!bridge) return undefined;
    const onVisibilityChange = () => { if (document.visibilityState === "visible" && !preview) refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [preview, refresh]);
  useEffect(() => () => {
    if (clientFollowUpTimer.current) window.clearTimeout(clientFollowUpTimer.current);
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (selected && !devices.some((device) => device.address === selected) && !servers.some((server) => server.address === selected)) setSelected(null);
  }, [selected, devices, servers]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (dialog || event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setView("devices");
      window.requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  function updateSample(address, changes) {
    setSample((previous) => previous.map((server) => ({ ...server, devices: server.devices.map((device) => device.address === address ? { ...device, ...changes } : device) })));
  }

  async function command(action, target, value) {
    if (preview) {
      const current = devices.find((device) => device.address === target);
      if (action === "use") updateSample(target, { inUse: true, localUse: true, detail: "In use by this preview" });
      else if (action === "stop") updateSample(target, { inUse: false, localUse: false, detail: "" });
      else if (action === "auto-device") updateSample(target, { autoUse: !current?.autoUse });
      else if (action === "device-rename") updateSample(target, { name: value });
      else if (action === "manual-add") setSample((previous) => [...previous, { name: value || target, address: target.includes(":") ? target : `${target}:7575`, devices: [] }]);
      if (action === "device-info" || action === "server-info") {
        const item = current || servers.find((server) => server.address === target);
        setDialog({ kind: "info", title: item?.name || "Properties", text: `${item?.name || target}\nAddress: ${item?.address || target}\nSource: Preview sample` });
      }
      record(action === "use" ? "Preview device connected" : action === "stop" ? "Preview device released" : "Preview changed", `${action} / ${target}`, "preview", true);
      setToast("Preview updated. No native USB session was changed.");
      return;
    }
    if (!liveReady) { setToast("The VirtualHere client must be running before a device command can be sent."); return; }
    setBusy(`${action}:${target}`);
    try {
      const result = await bridge.sendCommand({ action, target, ...(value !== undefined ? { value } : {}) });
      if (!result?.available) throw new Error(result?.reason || "Native client did not accept the command");
      if (action.endsWith("info")) setDialog({ kind: "info", title: action === "server-info" ? "Server properties" : "Device properties", text: result.reply || "No details returned" });
      else setToast(action === "use" ? "Connection requested. Waiting for the native client to confirm ownership." : action === "stop" ? "Release requested. Waiting for the native client to update." : result.reply || "Command sent to the native client");
      record(action === "use" ? "Device connection requested" : action === "stop" ? "Device release requested" : "Client command sent", `${action} / ${target}`, "live", false);
      await refresh();
      if (action === "use" || action === "stop") {
        if (clientFollowUpTimer.current) window.clearTimeout(clientFollowUpTimer.current);
        clientFollowUpTimer.current = window.setTimeout(() => {
          clientFollowUpTimer.current = null;
          if (document.visibilityState === "visible") refresh();
        }, 1600);
      }
    } catch (error) {
      record("Command failed", `${action} / ${error.message}`, "error", false);
      setToast(error.message);
    } finally { setBusy(""); }
  }

  async function openServer() {
    if (!bridge?.openServer) { setToast("Open the macOS app to use native server controls."); return; }
    setBusy("server");
    try {
      await bridge.openServer();
      record("Native server opened", "The installed VirtualHere server app was requested to open", "live", false);
      setToast("Native server app opened");
      await refresh();
    } catch (error) { setToast(error.message); }
    finally { setBusy(""); }
  }

  async function openClient() {
    if (!bridge?.openClient) { setToast("Open the macOS app to use native client controls."); return; }
    setBusy("client");
    try {
      await bridge.openClient();
      record("Native client launch requested", "The installed VirtualHere client app was requested to open", "live", false);
      setToast("Client launch requested. Checking its device state shortly.");
      await refresh();
      if (clientFollowUpTimer.current) window.clearTimeout(clientFollowUpTimer.current);
      clientFollowUpTimer.current = window.setTimeout(() => {
        clientFollowUpTimer.current = null;
        if (document.visibilityState === "visible") refresh();
      }, 1600);
    } catch (error) { setToast(error.message); }
    finally { setBusy(""); }
  }

  async function openClientDownload() {
    if (!bridge?.openClientDownload) { setToast("The official client download opens from the macOS app."); return; }
    try { await bridge.openClientDownload(); }
    catch (error) { setToast(error.message); }
  }

  async function showClientDiagnostics() {
    if (!bridge?.getDetailedState) { setToast("Native client diagnostics are unavailable."); return; }
    setBusy("diagnostics");
    try {
      const result = await bridge.getDetailedState();
      if (!result?.available) throw new Error(result?.reason || "The native client did not respond");
      setDialog({ kind: "info", title: "Native client diagnostics", text: result.document ? JSON.stringify(result.document, null, 2) : result.reply || "No details returned" });
    } catch (error) { setToast(error.message); }
    finally { setBusy(""); }
  }

  async function readLog() {
    if (!bridge?.readServerLog) { setToast("Server logs are available in the macOS app."); return; }
    setBusy("log");
    try {
      const log = await bridge.readServerLog();
      setDialog({ kind: "info", title: "Native server log", text: `${log.truncated ? "Showing the latest 64 KiB\n\n" : ""}${log.text || "The log is empty."}` });
    } catch (error) { setToast(error.message); }
    finally { setBusy(""); }
  }

  function navigate(target) { setView(target); if (target === "devices" && !selected && devices.length) setSelected(devices[0].address); }
  function openForm(kind, target = null, name = "") { setFormValue(name); setDialog({ kind, target, title: kind === "add-server" ? "Add a USB server" : "Rename device" }); }
  function submitForm() {
    const value = formValue.trim();
    if (!value) return;
    if (dialog.kind === "add-server") command("manual-add", value);
    else command("device-rename", dialog.target, value);
    setDialog(null);
  }

  const visibleServers = useMemo(() => servers.map((server) => ({
    ...server,
    devices: (server.devices || []).filter((device) => {
      const matchesText = `${device.name} ${device.address} ${server.name} ${server.address}`.toLowerCase().includes(searchQuery);
      const matchesFilter = filter === "all" || (filter === "available" && !device.inUse) || (filter === "connected" && device.localUse) || (filter === "occupied" && device.inUse && !device.localUse);
      return matchesText && matchesFilter;
    }),
  })).filter((server) => (filter === "all" && !searchQuery) || server.devices.length > 0 || (filter === "all" && `${server.name} ${server.address}`.toLowerCase().includes(searchQuery))), [servers, filter, searchQuery]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img src={logo} alt=""/><div><strong>SoftConnect</strong><span>USB WORKSPACE</span></div></div>
      <div className="sidebar-group-label">WORKSPACE</div>
      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map(([id, label, icon]) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}><Icon name={icon} size={18}/><span>{label}</span>{id === "connections" && connectedDevices.length > 0 && <b>{connectedDevices.length}</b>}</button>)}
      </nav>
      <div className="sidebar-group-label sidebar-tools-label">PREFERENCES</div>
      <button className={`nav-item settings-nav ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><Icon name="sliders" size={18}/><span>Settings</span></button>
      <div className="sidebar-bottom">
        <div className="sidebar-native"><span className={`native-pulse ${preview ? "sample" : liveReady ? "online" : checkingNative ? "checking" : "offline"}`}/><div><strong>{preview ? "Preview workspace" : liveReady ? "Native client ready" : checkingNative ? "Checking client" : "Client unavailable"}</strong><small>{preview ? "Sample data only" : liveReady ? "Local desktop connection" : checkingNative ? "Reading local components" : "Open VirtualHere client"}</small></div></div>
        <div className="sidebar-version">SOFTCONNECT <span>v{nativeStatus.appVersion || appVersion}</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14}/><strong>{view.charAt(0).toUpperCase() + view.slice(1)}</strong></div>
        <div className="top-actions"><span className={`mode-chip ${preview ? "sample" : liveReady ? "live" : checkingNative ? "checking" : "offline"}`}><span/>{preview ? "PREVIEW DATA" : liveReady ? "LIVE LOCAL" : checkingNative ? "CHECKING LOCAL CLIENT" : "NATIVE CLIENT OFFLINE"}</span><button className="icon-button sync-button" onClick={() => refresh(true)} disabled={syncState === "syncing"} title="Refresh native device list" aria-label="Refresh native device list"><Icon name="refresh" size={17} className={syncState === "syncing" || checkingNative ? "spinning" : ""}/></button></div>
      </header>

      <main className="main-content" id="main-content">
        {!preview && !liveReady && <div className={`connection-banner ${checkingNative ? "is-checking" : ""}`} role="status"><span className="banner-icon"><Icon name={checkingNative ? "refresh" : "warning"} size={18} className={checkingNative ? "spinning" : ""}/></span><div><strong>{checkingNative ? "Checking your local client" : bridge ? "Native client is not ready" : "Desktop bridge is unavailable"}</strong><p>{checkingNative ? "Looking for installed USB sharing components and device state." : bridge ? nativeClient.reason || "Start the installed VirtualHere client, then refresh to discover USB devices." : "Run SoftConnect as a macOS desktop app to access local USB devices."}</p></div>{bridge && !checkingNative && (nativeStatus.paths?.client ? <button className="text-button" onClick={openClient} disabled={Boolean(busy)}>Open client <Icon name="external" size={15}/></button> : <button className="text-button" onClick={openClientDownload}>Get official client <Icon name="external" size={15}/></button>)}<button className="text-button" onClick={() => setPreview(true)}>Explore preview <Icon name="arrow" size={15}/></button></div>}

        {view === "overview" && <>
          <div className="page-intro"><div><span className="eyebrow">CONTROL CENTER / 01</span><h1>{preview ? <>USB sharing,<br/><em>made simple.</em></> : liveReady ? <>Your USB workspace,<br/><em>connected.</em></> : <>Your USB workspace,<br/><em>within reach.</em></>}</h1><p>{preview ? "Explore devices and connections with sample data. No USB session is changed." : liveReady ? "See devices across your servers and bring the ones you need to this Mac." : checkingNative ? "Checking for the native client and shared devices on this Mac." : "Start the official client to discover USB devices across your servers."}</p></div><div className="hero-graphic" aria-hidden="true"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><span className="hero-node node-left"><Icon name="server" size={23}/></span><span className="hero-node node-center"><Icon name="link" size={33}/></span><span className="hero-node node-right"><Icon name="usb" size={23}/></span></div></div>
          <div className="quick-actions"><button className="button primary" disabled={checkingNative || (!bridge && !preview)} onClick={() => preview || liveReady ? navigate("devices") : nativeStatus.paths?.client ? openClient() : openClientDownload()}>{preview || liveReady ? "Browse devices" : checkingNative ? "Checking client" : nativeStatus.paths?.client ? "Open native client" : "Get official client"} <Icon name={preview || liveReady ? "arrow" : "external"} size={16}/></button><button className="button quiet" disabled={!preview && !liveReady} title={!preview && !liveReady ? "Start the native client to add a server" : undefined} onClick={() => openForm("add-server")}><Icon name="plus" size={16}/> Add server</button><span className="quick-hint">{preview ? "Preview actions are simulated" : liveReady ? "Device commands use the local native client" : "Native client required for device commands"}</span></div>
          <div className="overview-grid">
            <section className="panel featured-panel"><div className="panel-heading"><div><span className="eyebrow">DEVICE RADAR</span><h2>Ready to connect</h2></div><button className="link-button" onClick={() => navigate("devices")}>View all <Icon name="arrow" size={15}/></button></div>
              {featuredDevices.length ? <div className="compact-list">{featuredDevices.map((device) => <div className="compact-device" key={device.address}><button className="compact-device-open" onClick={() => { setSelected(device.address); navigate("devices"); }} aria-label={`Inspect ${device.name}`}><span className="device-icon"><Icon name={deviceIcon(device.name)} size={19}/></span><span className="compact-text"><strong>{device.name}</strong><small>{device.serverName}</small></span><Status kind="available">Available</Status></button><button className="button primary small compact-connect" disabled={Boolean(busy) || (!preview && !liveReady)} onClick={() => command("use", device.address)}>{preview ? "Try connect" : "Connect"}<Icon name="arrow" size={13}/></button></div>)}</div> : <EmptyState icon="usb" title="No available devices" description={preview ? "All sample devices are busy." : "Start the native client to discover devices."}/>}
            </section>
            <section className="panel health-panel"><div className="panel-heading"><div><span className="eyebrow">SYSTEM STATUS</span><h2>Workspace health</h2></div><span className="mini-signal"><Icon name="pulse" size={17}/></span></div><div className="health-row"><span className="health-icon"><Icon name="terminal" size={18}/></span><div><strong>Native client</strong><small>{preview ? "Preview simulation" : liveReady ? "Responding to local API" : checkingNative ? "Checking local API" : nativeClient.reason || "Not responding"}</small></div><Status kind={preview ? "preview" : liveReady ? "connected" : checkingNative ? "checking" : "offline"}>{preview ? "Preview" : liveReady ? "Ready" : checkingNative ? "Checking" : "Offline"}</Status></div><div className="health-row"><span className="health-icon"><Icon name="server" size={18}/></span><div><strong>Native server</strong><small>{preview ? "Preview does not start a server" : checkingNative ? "Checking this Mac" : nativeStatus.server.installed ? "Installed on this Mac" : "Not installed on this Mac"}</small></div><Status kind={preview ? "preview" : checkingNative ? "checking" : nativeStatus.server.running ? "connected" : "offline"}>{preview ? "Preview" : checkingNative ? "Checking" : nativeStatus.server.running ? "Running" : "Inactive"}</Status></div><div className="health-note"><Icon name="info" size={16}/><span>USB transport and drivers remain in the signed native applications.</span></div></section>
          </div>
          <div className="metric-grid">
            <div className="metric-card"><div className="metric-top"><span>AVAILABLE DEVICES</span><Icon name="usb" size={18}/></div><strong>{availableDevices.length.toString().padStart(2, "0")}</strong><small>Ready to connect</small></div>
            <div className="metric-card"><div className="metric-top"><span>CONNECTED HERE</span><Icon name="link" size={18}/></div><strong>{connectedDevices.length.toString().padStart(2, "0")}</strong><small>Active on this Mac</small></div>
            <div className="metric-card"><div className="metric-top"><span>USB SERVERS</span><Icon name="server" size={18}/></div><strong>{servers.length.toString().padStart(2, "0")}</strong><small>{servers.length === 1 ? "Server discovered" : "Servers discovered"}</small></div>
          </div>
        </>}

        {view === "devices" && <>
          <div className="section-header"><div><span className="eyebrow">DISCOVER / 02</span><h1>Devices</h1><p>Find a shared device, inspect its status, and connect it to this Mac.</p></div><button className="button quiet" disabled={!preview && !liveReady} title={!preview && !liveReady ? "Start the native client to add a server" : undefined} onClick={() => openForm("add-server")}><Icon name="plus" size={16}/> Add server</button></div>
          <div className="device-toolbar"><label className="search-box"><Icon name="search" size={18}/><input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search devices or servers" aria-label="Search devices or servers"/><kbd className="search-shortcut">Cmd K</kbd></label><div className="filter-tabs" role="group" aria-label="Filter devices">{[["all", "All"], ["available", "Available"], ["connected", "Connected"], ["occupied", "In use"]].map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
          <div className="device-layout"><section className="panel device-browser" aria-label="Shared USB devices"><div className="browser-heading"><span>{visibleServers.length} {visibleServers.length === 1 ? "SERVER" : "SERVERS"}</span><span>{visibleServers.reduce((count, server) => count + server.devices.length, 0)} DEVICES</span></div>
            {visibleServers.length ? visibleServers.map((server) => <div className="server-group" key={server.address}><button className="server-heading" aria-expanded={expanded[server.address] !== false} onClick={() => { setSelected(server.address); setExpanded((old) => ({ ...old, [server.address]: old[server.address] === false })); }}><span className="server-symbol"><Icon name="server" size={17}/></span><span><strong>{server.name}</strong><small>{server.address}</small></span><b>{server.devices.length}</b><Icon name="down" size={16} className={expanded[server.address] === false ? "folded" : ""}/></button>{expanded[server.address] !== false && <div className="server-devices">{server.devices.length ? server.devices.map((device) => { const state = deviceState(device); return <button key={device.address} className={`device-line ${selected === device.address ? "selected" : ""}`} onClick={() => setSelected(device.address)}><span className="device-icon"><Icon name={deviceIcon(device.name)} size={19}/></span><span className="device-line-name"><strong>{device.name}</strong><small>{device.address}</small></span>{device.autoUse && <span className="auto-label">AUTO</span>}<Status kind={state.key}>{state.label}</Status><Icon name="chevron" size={15}/></button>; }) : <p className="server-empty">No matching devices on this server.</p>}</div>}</div>) : <EmptyState icon="search" title="No matching devices" description={search || filter !== "all" ? "Try another search or filter." : preview ? "No preview devices available." : "Start the native client or add a server to discover devices."}/>}
          </section><aside className="panel device-inspector"><div className="inspector-top"><span className="eyebrow">DEVICE INSPECTOR</span><Icon name="spark" size={19}/></div>{selectedDevice ? <><div className="inspector-device-icon"><Icon name={deviceIcon(selectedDevice.name)} size={31}/></div><h2>{selectedDevice.name}</h2><p className="inspector-subtitle">Shared from {selectedDevice.serverName}</p><Status kind={deviceState(selectedDevice).key}>{deviceState(selectedDevice).label}</Status><dl className="details-list"><div><dt>Device address</dt><dd>{selectedDevice.address}</dd></div><div><dt>Server</dt><dd>{selectedDevice.serverName}</dd></div><div><dt>Auto use</dt><dd>{selectedDevice.autoUse ? "On" : "Off"}</dd></div><div><dt>Native detail</dt><dd>{selectedDevice.detail || "No additional detail"}</dd></div></dl><div className="inspector-buttons"><button className="button primary" disabled={Boolean(busy) || (!preview && !liveReady) || (selectedDevice.inUse && !selectedDevice.localUse)} onClick={() => command(selectedDevice.localUse ? "stop" : "use", selectedDevice.address)}>{selectedDevice.localUse ? "Release device" : selectedDevice.inUse ? "In use elsewhere" : "Connect device"} <Icon name={selectedDevice.localUse ? "close" : "arrow"} size={15}/></button><div><button className="button quiet" disabled={Boolean(busy) || (!preview && !liveReady)} onClick={() => command("device-info", selectedDevice.address)}>Properties</button><button className="button quiet" disabled={Boolean(busy) || (!preview && !liveReady)} onClick={() => openForm("rename", selectedDevice.address, selectedDevice.name)}>Rename</button></div><button className="link-button auto-action" disabled={Boolean(busy) || (!preview && !liveReady)} onClick={() => command("auto-device", selectedDevice.address)}>{selectedDevice.autoUse ? "Disable auto use" : "Enable auto use"}</button></div></> : selectedServer ? <><div className="inspector-device-icon"><Icon name="server" size={31}/></div><h2>{selectedServer.name}</h2><p className="inspector-subtitle">USB server</p><dl className="details-list"><div><dt>Address</dt><dd>{selectedServer.address}</dd></div><div><dt>Shared devices</dt><dd>{selectedServer.devices.length}</dd></div></dl><button className="button quiet inspector-wide" onClick={() => command("server-info", selectedServer.name)}>Server properties</button></> : <EmptyState icon="usb" title="Select a device" description="Choose a device from the list to see details and available actions."/>}</aside></div>
        </>}

        {view === "connections" && <><div className="section-header"><div><span className="eyebrow">ACTIVE SESSIONS / 03</span><h1>Connections</h1><p>See what is attached to this Mac and which devices are busy elsewhere.</p></div><Status kind={connectedDevices.length ? "connected" : "offline"}>{connectedDevices.length} connected here</Status></div><div className="connection-grid"><section className="panel connection-panel"><div className="panel-heading"><div><span className="eyebrow">THIS MAC</span><h2>Connected devices</h2></div><span className="count-box">{connectedDevices.length}</span></div>{connectedDevices.length ? <div className="session-list">{connectedDevices.map((device) => <div className="session-card" key={device.address}><span className="device-icon"><Icon name={deviceIcon(device.name)} size={20}/></span><div><strong>{device.name}</strong><small>{device.serverName} / {device.address}</small></div><button className="button quiet small" disabled={Boolean(busy)} onClick={() => command("stop", device.address)}>Release</button></div>)}</div> : <EmptyState icon="link" title="No active connections" description={preview ? "Connect a sample device from Devices to see it here." : "Devices connected on this Mac will appear here."} action={<button className="link-button" onClick={() => navigate("devices")}>Browse devices <Icon name="arrow" size={15}/></button>}/>}</section><section className="panel connection-panel"><div className="panel-heading"><div><span className="eyebrow">OTHER CLIENTS</span><h2>Currently in use</h2></div><span className="count-box amber">{remoteDevices.length}</span></div>{remoteDevices.length ? <div className="session-list">{remoteDevices.map((device) => <div className="session-card" key={device.address}><span className="device-icon amber-icon"><Icon name={deviceIcon(device.name)} size={20}/></span><div><strong>{device.name}</strong><small>{device.detail || `${device.serverName} / Currently unavailable`}</small></div><Status kind="occupied">Busy</Status></div>)}</div> : <EmptyState icon="check" title="Nothing busy elsewhere" description="Devices in use by another client appear here when the native client reports them."/>}</section></div><div className="insight-strip"><Icon name="shield" size={18}/><span>SoftConnect reports the native client state. Session ownership is determined by the native USB client.</span></div></>}

        {view === "activity" && <><div className="section-header"><div><span className="eyebrow">LOCAL TIMELINE / 04</span><h1>Activity</h1><p>Commands and results from this SoftConnect window, since it opened.</p></div><button className="button quiet" onClick={readLog} disabled={Boolean(busy) || preview || !bridge?.readServerLog}><Icon name="terminal" size={16}/> Native server log</button></div><section className="panel activity-panel"><div className="activity-header"><span>RECENT ACTIVITY</span><span>{activity.length} EVENTS THIS SESSION</span></div>{activity.length ? <ol className="timeline">{activity.map((event) => <li key={event.id}><span className={`timeline-icon ${event.kind}`}><Icon name={event.kind === "error" ? "warning" : event.kind === "preview" ? "spark" : "check"} size={15}/></span><div><strong>{event.title}</strong><p>{event.detail}</p><small>{timeFormat.format(new Date(event.time))} / {event.preview ? "Preview" : "Native action"}</small></div></li>)}</ol> : <EmptyState icon="pulse" title="No actions yet" description="Connect, release, or configure a device to see the result here. This is a window-local timeline, not a server audit log."/>}</section></>}

        {view === "settings" && <><div className="section-header"><div><span className="eyebrow">PREFERENCES / 05</span><h1>Settings</h1><p>Control this workspace and inspect its native integration.</p></div></div><div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">DISPLAY</span><h2>Workspace preferences</h2></div></div><label className="setting-row"><span className="setting-icon"><Icon name="refresh" size={18}/></span><span className="setting-copy"><strong>Automatic refresh</strong><small>Every 8 seconds when connected, every 30 seconds while offline, and paused when hidden.</small></span><input type="checkbox" role="switch" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)}/></label><label className="setting-row"><span className="setting-icon"><Icon name="spark" size={18}/></span><span className="setting-copy"><strong>Preview workspace</strong><small>Try the interface with sample devices. Changes never reach the native client.</small></span><input type="checkbox" role="switch" checked={preview} onChange={(event) => { setPreview(event.target.checked); setSelected(null); setToast(event.target.checked ? "Preview data is active" : "Back to native client state"); }}/></label><div className="settings-footnote">Preview mode is always labeled across the app. It does not simulate an actual USB transport.</div></section><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">NATIVE INTEGRATION</span><h2>Local components</h2></div></div><div className="component-row"><span className="setting-icon"><Icon name="terminal" size={18}/></span><div><strong>VirtualHere client</strong><small>{nativeStatus.paths?.client || (checkingNative ? "Checking supported locations" : "Not found in supported locations")}</small></div><Status kind={liveReady ? "connected" : checkingNative ? "checking" : "offline"}>{liveReady ? "Ready" : checkingNative ? "Checking" : "Offline"}</Status></div><div className="component-row"><span className="setting-icon"><Icon name="server" size={18}/></span><div><strong>VirtualHere server</strong><small>{nativeStatus.paths?.serverApp || (checkingNative ? "Checking supported locations" : "Not installed in supported locations")}</small></div><Status kind={checkingNative ? "checking" : nativeStatus.server?.running ? "connected" : "offline"}>{checkingNative ? "Checking" : nativeStatus.server?.running ? "Running" : "Inactive"}</Status></div><div className="settings-actions">{nativeStatus.paths?.client ? <button className="button quiet" onClick={openClient} disabled={Boolean(busy)}><Icon name="external" size={16}/> Open native client</button> : <button className="button quiet" onClick={openClientDownload} disabled={!bridge || checkingNative}><Icon name="external" size={16}/> Get official client</button>}<button className="button quiet" onClick={showClientDiagnostics} disabled={Boolean(busy) || !liveReady}><Icon name="info" size={16}/> Client diagnostics</button><button className="button quiet" onClick={openServer} disabled={Boolean(busy) || !nativeStatus.server?.installed}><Icon name="external" size={16}/> Open native server</button><button className="button quiet" onClick={() => refresh(true)}><Icon name="refresh" size={16}/> Refresh status</button></div></section></div><section className="panel about-panel"><span className="about-logo"><img src={logo} alt=""/></span><div><strong>SoftConnect</strong><p>An original desktop interface for the documented local VirtualHere client API. The installed native software handles USB transport, OS drivers, and licensing.</p></div><span>v{nativeStatus.appVersion || appVersion}</span></section></>}
      </main>

      <footer className="statusbar"><span><span className={`statusbar-dot ${preview ? "sample" : liveReady ? "online" : checkingNative ? "checking" : "offline"}`}/>{preview ? "Preview data" : liveReady ? "Native client connected" : checkingNative ? "Checking local client" : "Native client offline"}</span><span>{preview ? "Sample workspace" : checkingNative ? "Reading native state" : lastSync ? `Last checked ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(lastSync)}` : "No status yet"}</span></footer>
    </div>

    {toast && <div className="toast" role="status"><Icon name="info" size={17}/>{toast}<button onClick={() => setToast("")} aria-label="Dismiss message"><Icon name="close" size={14}/></button></div>}
    {dialog && <Dialog title={dialog.title} onClose={() => setDialog(null)} footer={dialog.kind === "add-server" || dialog.kind === "rename" ? <><button className="button quiet" onClick={() => setDialog(null)}>Cancel</button><button className="button primary" disabled={!formValue.trim()} onClick={submitForm}>{dialog.kind === "add-server" ? "Add server" : "Save name"}</button></> : null}>{dialog.kind === "info" ? <pre className="properties-text">{dialog.text}</pre> : <><p>{dialog.kind === "add-server" ? "Enter the address of a USB server to add it to the native client's manual hub list." : "Choose a display name for this device."}</p><label className="field-label" htmlFor="dialog-value">{dialog.kind === "add-server" ? "Server address" : "Device name"}</label><input id="dialog-value" className="dialog-input" autoFocus value={formValue} onChange={(event) => setFormValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitForm(); }} placeholder={dialog.kind === "add-server" ? "server.local:7575" : "Device name"}/><small>{preview ? "This updates preview data only." : "A native client command is sent when you save."}</small></>}</Dialog>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App/>);
