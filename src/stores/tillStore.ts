import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Why the till is locked — the lock screen says so rather than just appearing. */
export type LockReason = "manual" | "idle" | null;

/**
 * Whether the till is locked, and why.
 *
 * Persisted on purpose: a refresh, a crash or a reboot must not be a way past
 * the lock. It lives in localStorage next to the terminal's lane, because like
 * the lane it is a property of the DEVICE — the tablet at counter 3 is locked,
 * not "Ayesha's session is locked".
 *
 * This is a UI gate, not a security boundary: the browser still holds a valid
 * token while locked. It stops the next person walking up and ringing a sale
 * under the last person's name, which is the actual problem on a shop floor.
 * Taking the till properly — a different cashier's PIN — swaps the session
 * server-side and ends the outgoing one. See TillLock.
 */
interface TillState {
  locked: boolean;
  reason: LockReason;
  lock: (reason: Exclude<LockReason, null>) => void;
  unlock: () => void;
}

export const useTillStore = create<TillState>()(
  persist(
    (set) => ({
      locked: false,
      reason: null,
      lock: (reason) => set({ locked: true, reason }),
      unlock: () => set({ locked: false, reason: null }),
    }),
    { name: "shopos-till" },
  ),
);
