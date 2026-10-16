import { useSyncExternalStore } from "react";

// A tiny store outside React state: showing a toast re-renders only the toast stack, not the whole app.
const listeners = new Set();
let toasts = [];
let nextId = 1;
const DURATION = { info: 4200, success: 3600, error: 8000 };
const MAX_VISIBLE = 3;

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id) {
  const before = toasts.length;
  toasts = toasts.filter((toast) => toast.id !== id);
  if (toasts.length !== before) emit();
}

export function notify(text, kind = "info") {
  if (!text) return;
  // Repeating the same message refreshes it instead of stacking duplicates.
  const existing = toasts.find((toast) => toast.text === text);
  if (existing) dismissToast(existing.id);
  const toast = { id: nextId++, text, kind };
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => dismissToast(toast.id), DURATION[kind] || DURATION.info);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts() {
  return useSyncExternalStore(subscribe, () => toasts);
}
