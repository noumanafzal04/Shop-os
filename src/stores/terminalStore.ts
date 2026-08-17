import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which checkout lane THIS DEVICE is. Sent as X-Register-Id on every request.
 *
 * Deliberately a per-device choice, not a per-user one: lane 3 is lane 3
 * whoever is standing at it, and the tablet bolted to lane 3 should still be
 * lane 3 after a shift change, a logout, or a reboot. That's exactly what
 * localStorage models — so this store persists, and nothing about it lives on
 * the user record.
 *
 * Null = a shop that doesn't use lanes; the server then behaves exactly as it
 * did before registers existed.
 */
interface TerminalState {
  activeRegisterId: string | null;
  /** Remembered for the picker's label so a cold load has no blank frame. */
  activeRegisterName: string | null;
  setTerminal: (id: string | null, name?: string | null) => void;
  /**
   * Show the on-screen number pad at this till.
   *
   * Per-device for the same reason the lane is: whether you need a keypad is a
   * fact about the hardware in front of you, not about who logged in. The
   * tablet on a stand keeps it; the desktop with a real keyboard never shows
   * it, however many cashiers pass through both.
   */
  numPad: boolean;
  setNumPad: (on: boolean) => void;
  /**
   * Tiles or rows in the till's product pane.
   *
   * NULL means "whatever this trade defaults to" — a kitchen browses pictures,
   * a pharmacy scans a dense list — and null is what every existing till holds,
   * so nothing changes for anybody until somebody presses the toggle.
   *
   * Per-device, like the lane and the keypad, and for the same reason: which
   * of the two works better is a fact about the SCREEN and how the person at
   * it works. The same shop can want tiles on the touchscreen at the counter
   * and rows on the back-office desktop, and neither should overwrite the
   * other when a cashier logs in at both.
   */
  posView: "grid" | "list" | null;
  setPosView: (view: "grid" | "list" | null) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      activeRegisterId: null,
      activeRegisterName: null,
      setTerminal: (id, name = null) => set({ activeRegisterId: id, activeRegisterName: name }),
      numPad: false,
      setNumPad: (on) => set({ numPad: on }),
      posView: null,
      setPosView: (view) => set({ posView: view }),
    }),
    { name: "shopos-terminal" },
  ),
);
