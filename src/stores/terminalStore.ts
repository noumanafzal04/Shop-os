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
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      activeRegisterId: null,
      activeRegisterName: null,
      setTerminal: (id, name = null) => set({ activeRegisterId: id, activeRegisterName: name }),
      numPad: false,
      setNumPad: (on) => set({ numPad: on }),
    }),
    { name: "shopos-terminal" },
  ),
);
