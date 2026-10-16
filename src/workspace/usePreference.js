import { useCallback, useState } from "react";

// Per-machine UI preferences. Storage can be unavailable, so every access falls back quietly.
export function usePreference(key, fallback) {
  const storageKey = `softconnect:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  const update = useCallback((next) => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Preferences are a convenience; the in-memory value still applies.
    }
  }, [storageKey]);
  return [value, update];
}
