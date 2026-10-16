import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "./toasts.js";

const bridge = window.softconnect;

// Mirrors the main-process updater: status arrives as "update" events, actions go through the preload.
export function useUpdates() {
  const [status, setStatus] = useState(null);
  const announced = useRef(new Set());

  useEffect(() => {
    if (!bridge?.getUpdateStatus) return undefined;
    let active = true;
    bridge.getUpdateStatus().then((next) => { if (active && next) setStatus(next); }, () => {});
    const unsubscribe = bridge.onEvent?.((event) => {
      if (event?.type === "update" && event.status) setStatus(event.status);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // Each milestone is announced once per window.
  useEffect(() => {
    if (!status) return;
    const once = (key, text, kind) => {
      if (announced.current.has(key)) return;
      announced.current.add(key);
      notify(text, kind);
    };
    if (status.updatedFrom) once(`updated:${status.currentVersion}`, `SoftConnect was updated to ${status.currentVersion}.`, "success");
    if (status.state === "ready") once(`ready:${status.latestVersion}`, `SoftConnect ${status.latestVersion} is ready. It installs when you quit, or restart now.`, "success");
  }, [status]);

  const call = useCallback(async (method, ...args) => {
    if (!bridge?.[method]) {
      notify("Updates are available in the macOS app.", "error");
      return null;
    }
    try {
      const next = await bridge[method](...args);
      if (next && typeof next === "object") setStatus(next);
      return next;
    } catch (error) {
      notify(error?.message || "The update action failed", "error");
      return null;
    }
  }, []);

  const actions = useMemo(() => ({
    check: async () => {
      const next = await call("checkForUpdates");
      if (next?.state === "up-to-date") notify(`SoftConnect ${next.currentVersion} is the latest version.`, "success");
      else if (next?.state === "error") notify(`Couldn't check for updates: ${next.error}`, "error");
    },
    download: () => call("downloadUpdate"),
    install: () => call("installUpdate"),
    setAutoUpdate: (enabled) => call("setAutoUpdate", enabled),
    openReleasePage: () => call("openReleasePage"),
  }), [call]);

  return { status, actions };
}
