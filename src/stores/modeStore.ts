import { create } from "zustand";
import { prefs } from "../common/utils/prefs";

export type AppMode = "customer" | "rider";

/**
 * WHICH HAT IS ON.
 *
 * ── Why this is a mode and not a route ───────────────────────────────
 *
 * A rider is a customer who was approved, on one account. Before this, the
 * rider screens hung off the shopping stack and a rider on shift still had
 * Food, Grocery and a basket along the bottom of every screen — five things
 * that have nothing to do with the job in their hand, and no way to put the
 * shopping half away.
 *
 * So the mode swaps the whole tab bar and the whole menu. In rider mode there
 * is no basket, because a rider on shift is not shopping.
 *
 * ── A preference is not a permission ─────────────────────────────────
 *
 * The stored mode is a memory of what somebody was doing, and it is only ever
 * honoured for an account the SERVER still says is an approved rider.
 * `syncFromProfile` is what enforces that: a suspended rider, or one whose
 * approval was withdrawn while the app was closed, is put back into the shop
 * rather than left holding a job board they can no longer use.
 */
interface ModeState {
  mode: AppMode;
  /**
   * True while the app is changing hats.
   *
   * The swap replaces the entire navigator, which is a visible tear — the old
   * tab bar for a frame, then a blank, then the new one. Holding a cover over
   * it for a moment is not decoration: it is the difference between "the app
   * changed" and "the app glitched".
   */
  switching: boolean;
  /** Where the switch is going, so the cover can name it. */
  target: AppMode | null;

  setMode: (mode: AppMode) => void;
  /** Switch with the cover shown. Resolves once the new tree is up. */
  switchTo: (mode: AppMode) => void;
  /** Restore a remembered mode at boot, if it is still allowed. */
  hydrate: (mode: AppMode | undefined, canRide: boolean) => void;
  /** The server's verdict, applied. Demotes; never promotes. */
  syncFromProfile: (canRide: boolean) => void;
}

/**
 * How long the cover stays up.
 *
 * Long enough to read the word, short enough not to be a wait. The navigator
 * swap itself is a few frames; this is a deliberate beat, not a spinner
 * waiting on work.
 */
export const MODE_SWITCH_MS = 700;

export const useModeStore = create<ModeState>((set, get) => ({
  mode: "customer",
  switching: false,
  target: null,

  setMode: (mode) => {
    set({ mode });
    prefs.setMode(mode).catch(() => {});
  },

  switchTo: (mode) => {
    if (get().switching || get().mode === mode) return;

    set({ switching: true, target: mode });

    // The tree is swapped BEHIND the cover, halfway through, so the new one
    // has mounted and drawn by the time the cover lifts.
    setTimeout(() => {
      get().setMode(mode);
    }, MODE_SWITCH_MS / 2);

    setTimeout(() => {
      set({ switching: false, target: null });
    }, MODE_SWITCH_MS);
  },

  hydrate: (mode, canRide) => {
    set({ mode: mode === "rider" && canRide ? "rider" : "customer" });
  },

  syncFromProfile: (canRide) => {
    // DEMOTES ONLY. Somebody who is no longer approved cannot stay on a job
    // board; somebody who just got approved is not thrown into rider mode
    // without asking — that is a switch they press.
    if (!canRide && get().mode === "rider") {
      set({ mode: "customer", switching: false, target: null });
      prefs.setMode("customer").catch(() => {});
    }
  },
}));
