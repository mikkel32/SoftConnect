import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { version as appVersion } from "../../package.json";
import { findDevice, flattenDevices, groupDevices, INFO_ACTIONS, OWNERSHIP_ACTIONS, sameClientState } from "./model.js";
import { applyPreviewCommand, previewInfo, sampleServers } from "./preview.js";
import { notify } from "./toasts.js";
import { usePreference } from "./usePreference.js";

const bridge = window.softconnect;

const LIVE_POLL_MS = 8000;
// Used while the client is offline or the window is in the background.
const IDLE_POLL_MS = 30000;
// After USE / STOP USING is accepted, LIST is re-read on this schedule until ownership flips.
// Steps stay at or above the main process's 750 ms LIST cache so each one is a real read.
const SETTLE_STEPS_MS = [0, 750, 1000, 1500, 2500];
// Consecutive failed reads tolerated while settling before the client is reported as gone.
const SETTLE_FAILURES_ALLOWED = 1;
// After the client app is opened, wait this long between checks for its API to answer.
const LAUNCH_STEPS_MS = [600, 1000, 1500, 2500, 3500];
// Focus and visibility changes refresh only when the last read is older than this.
const WAKE_REFRESH_GAP_MS = 2000;
const PREVIEW_LATENCY_MS = 450;
const ACTIVITY_LIMIT = 60;

const initialStatus = { paths: { client: null, serverApp: null }, server: { installed: false, running: false }, appVersion };
const waitingClient = { available: false, servers: [], flags: {}, reason: "Waiting for native client" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COMMAND_COPY = {
  use: { requested: "Connection requested", done: (name) => `${name} is connected to this Mac` },
  stop: { requested: "Release requested", done: (name) => `${name} was released` },
  "auto-device": { done: (name) => `Auto use changed for ${name}` },
  "device-rename": { done: (_name, value) => `Device renamed to ${value}` },
  "manual-add": { done: (_name, _value, target) => `Server ${target} added` },
};

export function useWorkspace() {
  const [preview, setPreview] = useState(false);
  const [sample, setSample] = useState(sampleServers);
  const [nativeStatus, setNativeStatus] = useState(initialStatus);
  const [nativeClient, setNativeClient] = useState(waitingClient);
  const [initialized, setInitialized] = useState(!bridge);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [pending, setPending] = useState({});
  const [activity, setActivity] = useState([]);
  const [autoRefresh, setAutoRefresh] = usePreference("autoRefresh", true);

  const mode = preview ? "preview" : !bridge ? "unavailable" : !initialized ? "checking" : nativeClient.available ? "live" : "offline";
  const servers = preview ? sample : nativeClient.servers;
  const devices = useMemo(() => flattenDevices(servers), [servers]);
  const groups = useMemo(() => groupDevices(devices), [devices]);
  const canCommand = mode === "preview" || mode === "live";

  // Actions are created once and read current values through this ref.
  const latest = useRef(null);
  useLayoutEffect(() => {
    latest.current = { preview, mode, servers, nativeClient, lastSync, autoRefresh };
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Pending work is tracked per target, so one slow command never freezes unrelated controls.
  const pendingKeys = useRef(new Set());
  const begin = useCallback((key, action) => {
    if (pendingKeys.current.has(key)) return false;
    pendingKeys.current.add(key);
    setPending((current) => ({ ...current, [key]: action }));
    return true;
  }, []);
  const end = useCallback((key) => {
    pendingKeys.current.delete(key);
    setPending((current) => {
      const { [key]: _finished, ...rest } = current;
      return rest;
    });
  }, []);

  const record = useCallback((title, detail, kind) => {
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, time: Date.now(), title, detail, kind };
    setActivity((entries) => [entry, ...entries].slice(0, ACTIVITY_LIMIT));
  }, []);

  const readSnapshot = useCallback(async (fresh) => {
    let client;
    try {
      const snapshot = await bridge.getSnapshot({ fresh });
      const status = snapshot?.status;
      if (status) setNativeStatus((previous) => (JSON.stringify(previous) === JSON.stringify(status) ? previous : status));
      client = { servers: [], flags: {}, ...(snapshot?.state || {}) };
    } catch (error) {
      client = { available: false, servers: [], flags: {}, reason: error?.message || "Client state could not be read" };
    }
    if (!Array.isArray(client.servers)) client.servers = [];
    setNativeClient((previous) => (sameClientState(previous, client) ? previous : client));
    setLastSync(Date.now());
    setInitialized(true);
    return client;
  }, []);

  // Concurrent callers share one read. `after` queues a new read behind any read already in flight,
  // so state requested after a command is never answered by a read that started before it.
  // `fresh` also asks the main process to bypass its caches (explicit user refreshes only).
  const inFlight = useRef(null);
  const refresh = useCallback(({ after = false, fresh = false } = {}) => {
    if (!bridge) return Promise.resolve(null);
    if (inFlight.current && !after && !fresh) return inFlight.current;
    const task = (inFlight.current || Promise.resolve()).then(() => readSnapshot(fresh));
    inFlight.current = task;
    task.finally(() => { if (inFlight.current === task) inFlight.current = null; });
    return task;
  }, [readSnapshot]);

  const refreshNow = useCallback(async () => {
    if (!bridge) {
      notify("The desktop bridge is unavailable. Open the macOS app, or explore Preview.", "error");
      return;
    }
    setSyncing(true);
    const client = await refresh({ fresh: true });
    if (!mounted.current) return;
    setSyncing(false);
    if (latest.current.preview) notify("Native state refreshed. Preview data is still shown.");
    else if (client?.available) notify("Device list refreshed", "success");
    else notify(client?.reason || "Could not read the native client", "error");
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  // Polling: a timeout chain (never overlapping) that slows down when the client is offline or the
  // window is in the background, and catches up immediately when the window comes back.
  useEffect(() => {
    if (!bridge || preview || !autoRefresh) return undefined;
    let cancelled = false;
    let running = false;
    let timer;
    // Taken from the read itself: React may not have committed it to `latest` yet.
    let available = latest.current?.nativeClient.available;
    const schedule = () => {
      window.clearTimeout(timer);
      const fast = available && document.hasFocus();
      timer = window.setTimeout(tick, fast ? LIVE_POLL_MS : IDLE_POLL_MS);
    };
    async function tick() {
      window.clearTimeout(timer);
      if (running) return;
      running = true;
      try {
        if (document.visibilityState === "visible") available = Boolean((await refresh())?.available);
      } finally {
        running = false;
      }
      if (!cancelled) schedule();
    }
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - (latest.current?.lastSync || 0) > WAKE_REFRESH_GAP_MS) tick();
      else schedule();
    };
    schedule();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [autoRefresh, preview, refresh]);

  const setPreviewMode = useCallback((enabled) => {
    setPreview(enabled);
    if (!enabled) refresh();
  }, [refresh]);

  const settle = useCallback(async (address, wantLocal) => {
    let failures = 0;
    for (const wait of SETTLE_STEPS_MS) {
      if (wait) await sleep(wait);
      if (!mounted.current) return "cancelled";
      const client = await refresh({ after: true });
      if (!client?.available) {
        if (++failures > SETTLE_FAILURES_ALLOWED) return "offline";
        continue;
      }
      failures = 0;
      const device = findDevice(client.servers, address);
      if (!device) return "missing";
      if (Boolean(device.localUse) === wantLocal) return "confirmed";
    }
    return "unconfirmed";
  }, [refresh]);

  // Runs a client API command. Info commands resolve to their text; everything else resolves to null.
  const command = useCallback(async (action, target, value) => {
    const { preview: isPreview, mode: currentMode, servers: currentServers } = latest.current;
    if (!isPreview && currentMode !== "live") {
      notify("Start the VirtualHere client before sending device commands.", "error");
      return null;
    }
    // Device commands are keyed by address so every list can find them; other targets get a prefix.
    const key = action === "server-info" ? `server:${target}` : action === "manual-add" ? `hub:${target}` : target;
    if (!begin(key, action)) return null;
    const name = findDevice(currentServers, target)?.name || target;
    const copy = COMMAND_COPY[action];
    try {
      if (isPreview) {
        await sleep(PREVIEW_LATENCY_MS);
        if (INFO_ACTIONS.has(action)) return previewInfo(latest.current.servers, action, target);
        setSample((current) => applyPreviewCommand(current, action, target, value));
        const message = copy?.done(name, value, target) || "Preview updated";
        record(message, `${action} · ${target}`, "preview");
        notify(`${message} (preview)`, "success");
        return null;
      }
      const result = await bridge.sendCommand({ action, target, ...(value !== undefined ? { value } : {}) });
      if (!result?.available) throw new Error(result?.reason || "The native client did not accept the command");
      if (INFO_ACTIONS.has(action)) return result.reply || "No details returned";
      if (OWNERSHIP_ACTIONS.has(action)) {
        record(copy.requested, `${name} · ${target}`, "live");
        const outcome = await settle(target, action === "use");
        if (outcome === "confirmed") {
          record(copy.done(name), target, "success");
          notify(copy.done(name), "success");
        } else if (outcome === "unconfirmed") {
          notify(`The client accepted the request, but ${name} has not changed yet. It will update on the next refresh.`);
        } else if (outcome === "missing") {
          notify(`${name} is no longer listed by the client.`, "error");
        } else if (outcome === "offline") {
          notify("The client stopped responding before the change was confirmed.", "error");
        }
        return null;
      }
      await refresh({ after: true });
      const message = copy?.done(name, value, target) || result.reply || "Command sent";
      record(message, `${action} · ${target}`, "success");
      notify(message, "success");
      return null;
    } catch (error) {
      const message = error?.message || "The command failed";
      record("Command failed", `${action} · ${target} · ${message}`, "error");
      notify(message, "error");
      return null;
    } finally {
      end(key);
    }
  }, [begin, end, record, refresh, settle]);

  const task = useCallback(async (key, run) => {
    if (!begin(key, "task")) return null;
    try {
      return await run();
    } catch (error) {
      notify(error?.message || "Something went wrong", "error");
      return null;
    } finally {
      end(key);
    }
  }, [begin, end]);

  const openClient = useCallback(() => task("task:client", async () => {
    if (!bridge?.openClient) throw new Error("Open the macOS app to use native client controls.");
    await bridge.openClient();
    record("Client launch requested", "Opening the installed VirtualHere client", "live");
    notify("Opening the VirtualHere client…");
    for (const wait of LAUNCH_STEPS_MS) {
      await sleep(wait);
      if (!mounted.current) return null;
      const client = await refresh({ fresh: true });
      if (client?.available) {
        notify("The VirtualHere client is ready", "success");
        return null;
      }
    }
    notify(latest.current.autoRefresh
      ? "The client has not answered yet. SoftConnect keeps checking in the background."
      : "The client has not answered yet. Press ⌘R to check again.");
    return null;
  }), [record, refresh, task]);

  const openServer = useCallback(() => task("task:server", async () => {
    if (!bridge?.openServer) throw new Error("Open the macOS app to use native server controls.");
    await bridge.openServer();
    record("Server app opened", "Opening the installed VirtualHere server", "live");
    notify("Opening the VirtualHere server…");
    await sleep(1200);
    await refresh({ fresh: true });
    return null;
  }), [record, refresh, task]);

  const openClientDownload = useCallback(() => task("task:download", async () => {
    if (!bridge?.openClientDownload) throw new Error("The official client download opens from the macOS app.");
    await bridge.openClientDownload();
    return null;
  }), [task]);

  const readServerLog = useCallback(() => task("task:log", async () => {
    if (!bridge?.readServerLog) throw new Error("Server logs are available in the macOS app.");
    const log = await bridge.readServerLog();
    return `${log.truncated ? "Showing the latest 64 KiB\n\n" : ""}${log.text || "The log is empty."}`;
  }), [task]);

  const readDiagnostics = useCallback(() => task("task:diagnostics", async () => {
    if (!bridge?.getDetailedState) throw new Error("Native client diagnostics are unavailable.");
    const result = await bridge.getDetailedState();
    if (!result?.available) throw new Error(result?.reason || "The native client did not respond");
    return result.document ? JSON.stringify(result.document, null, 2) : result.reply || "No details returned";
  }), [task]);

  const clearActivity = useCallback(() => setActivity([]), []);

  const state = useMemo(() => ({
    mode, preview, servers, devices, groups, canCommand, pending, activity, autoRefresh, syncing, lastSync,
    nativeStatus, clientReason: nativeClient.reason, hasBridge: Boolean(bridge),
  }), [mode, preview, servers, devices, groups, canCommand, pending, activity, autoRefresh, syncing, lastSync, nativeStatus, nativeClient.reason]);

  const actions = useMemo(() => ({
    refresh: refreshNow, command, openClient, openServer, openClientDownload, readServerLog, readDiagnostics,
    setPreview: setPreviewMode, setAutoRefresh, clearActivity,
  }), [refreshNow, command, openClient, openServer, openClientDownload, readServerLog, readDiagnostics, setPreviewMode, setAutoRefresh, clearActivity]);

  return { state, actions };
}
