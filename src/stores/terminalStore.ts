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
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      activeRegisterId: null,
      activeRegisterName: null,
      setTerminal: (id, name = null) => set({ activeRegisterId: id, activeRegisterName: name }),
    }),
    { name: "shopos-terminal" },
  ),
);
