import { create } from "zustand";

/**
 * Whether the till can actually reach the shop's server.
 *
 * Deliberately driven by real traffic, not by `navigator.onLine` alone: a till
 * on a shop wifi with a dead uplink reports itself online all day. The axios
 * interceptor marks this false when a request dies with no response, and true
 * again the moment one succeeds — so the badge reflects what the last real
 * request found, which is the only thing worth showing a cashier.
 *
 * Not persisted: connectivity at the moment of a page load is unknown until
 * something is tried, and starting pessimistic would flash a false alarm.
 */
interface ConnectionState {
  /** The last request reached the server. */
  reachable: boolean;
  /** The browser thinks it has a network at all. */
  online: boolean;
  /** Epoch ms of the last successful response. */
  lastOkAt: number | null;
  markReachable: () => void;
  markUnreachable: () => void;
  setOnline: (online: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  reachable: true,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  lastOkAt: null,
  markReachable: () => set({ reachable: true, lastOkAt: Date.now() }),
  markUnreachable: () => set({ reachable: false }),
  setOnline: (online) => set({ online }),
}));

if (typeof window !== "undefined") {
  window.addEventListener("online", () => useConnectionStore.getState().setOnline(true));
  window.addEventListener("offline", () => useConnectionStore.getState().setOnline(false));
}
