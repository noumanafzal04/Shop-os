import { create } from "zustand";

/**
 * Asking before doing something that cannot be undone.
 *
 * ── Why not `Alert.alert` ─────────────────────────────────────────────
 *
 * The system dialog is drawn by the OS, so it takes none of the app's type, none
 * of its colour, and none of its shape. It looks like a permission prompt —
 * which is exactly the thing people have learned to dismiss without reading.
 * "Your basket has items from another shop" deserves to be read, because the
 * answer throws away work somebody did.
 *
 * Promise-based so a call site reads as one thought:
 *
 *     if (await confirm.ask({ ... })) doTheThing();
 *
 * Rather than a callback that runs somewhere else, later, out of order.
 */

export interface ConfirmRequest {
  title: string;
  /** Why it matters, in the person's terms — never "Are you sure?". */
  message?: string;
  /** The button that does the thing. Says WHAT it does, never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive gets the error colour; the default is the brand. */
  tone?: "danger" | "default";
}

interface ConfirmState {
  request: (ConfirmRequest & { id: number }) | null;
  ask: (request: ConfirmRequest) => Promise<boolean>;
  /** Answered by the host — never called from a screen. */
  answer: (accepted: boolean) => void;
}

let seq = 0;
let pending: ((accepted: boolean) => void) | null = null;

export const useConfirmStore = create<ConfirmState>()((set) => ({
  request: null,

  ask: (request) =>
    new Promise<boolean>((resolve) => {
      // A second ask while one is open would strand the first promise for ever,
      // and the screen behind it waits on a resolve that never comes. The older
      // question is answered "no" — nothing happens, which is the safe half.
      pending?.(false);
      pending = resolve;
      set({ request: { ...request, id: ++seq } });
    }),

  answer: (accepted) => {
    const resolve = pending;
    pending = null;
    set({ request: null });
    resolve?.(accepted);
  },
}));

export const confirm = {
  ask: (request: ConfirmRequest) => useConfirmStore.getState().ask(request),
};
