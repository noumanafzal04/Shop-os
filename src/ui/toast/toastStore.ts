import { create } from "zustand";

/**
 * Toasts — the app's one way of saying "that worked" or "that didn't".
 *
 * ── Why a store and not a hook ─────────────────────────────────────────
 *
 * The place that most needs to raise a toast is a mutation's `onError`, which
 * is a plain callback with no component around it. A `useToast()` hook cannot
 * be called there, so every screen would end up wiring its own `const t =
 * useToast()` down into a handler — and the ones that forgot would fail
 * silently, which is the failure mode a toast exists to prevent.
 *
 * `toast.error(...)` works from anywhere, including a service.
 */

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** A second line — the detail under a short headline. Optional. */
  detail?: string;
  /** Milliseconds on screen. */
  duration: number;
}

/**
 * At most three at once.
 *
 * A screen that fires six failures — a sync flushing a queue, say — would
 * otherwise cover itself with its own error messages, and the sixth is on top
 * of the one the person was reading. Older ones drop off the back, because the
 * newest is the one they are waiting on.
 */
const MAX_VISIBLE = 3;

/** Errors get longer: they are usually read, not glanced at. */
const DEFAULTS: Record<ToastKind, number> = {
  success: 2600,
  info: 3000,
  warning: 4000,
  error: 5000,
};

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  push: ({ kind, message, detail, duration }) => {
    const id = `t${++seq}`;

    set((s) => {
      // The same message twice running is one event the app noticed twice —
      // a retry, a double tap, two queued rows failing for one reason. Showing
      // it twice tells the reader nothing and costs them a slot.
      const last = s.toasts[s.toasts.length - 1];
      if (last && last.message === message && last.detail === detail) return s;

      const next: Toast = {
        id,
        kind,
        message,
        detail,
        duration: duration ?? DEFAULTS[kind],
      };

      return { toasts: [...s.toasts, next].slice(-MAX_VISIBLE) };
    });

    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

type Options = { detail?: string; duration?: number };

const raise = (kind: ToastKind) => (message: string, options: Options = {}) =>
  useToastStore.getState().push({ kind, message, ...options });

/** Callable from anywhere — a component, a hook, a mutation callback, a service. */
export const toast = {
  success: raise("success"),
  error: raise("error"),
  info: raise("info"),
  warning: raise("warning"),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
