import { create } from "zustand";

/**
 * WHAT THE APP KNOWS ABOUT ITS OWN VERSION, IN ONE PLACE.
 *
 * `useRegisterSW` may be called exactly once — calling it in a second
 * component registers the service worker a second time — so `UpdatePrompt`
 * owns it and publishes what it learns here. Anything else that needs to know
 * whether a new build is waiting, or wants to go and ask, reads this.
 *
 * Nothing in here reloads anything by itself. `apply` is the reload, and it is
 * only ever called because a person pressed a button: an update swaps the
 * running app, and on a till that must be a moment somebody chose.
 */
interface UpdateState {
  /** Set once the worker registers. Absent on plain http, where it cannot. */
  registration: ServiceWorkerRegistration | undefined;
  /** A newer build has been downloaded and is waiting to take over. */
  ready: boolean;
  /** Reload into the waiting build. Null until there is one. */
  apply: (() => void) | null;

  publish: (patch: Partial<Omit<UpdateState, "publish">>) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  registration: undefined,
  ready: false,
  apply: null,
  publish: (patch) => set(patch),
}));
