import { createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * The device's storage, for a NOTE — something kept to save asking again.
 *
 * A browser may refuse to store: its space is full, it is a private window,
 * or a locked-down profile forbids it. For the session or a cart that is
 * worth knowing about. For a note it is not — the server still has the
 * answer, and the cost of not keeping it is one request on the next load.
 *
 * What it must never cost is the answer itself. Zustand writes to storage
 * inside `setState` and lets the browser's error out through it, so a full
 * disk would turn "the settings arrived" into a failed query, or an error
 * thrown out of an effect — a blank screen in place of a shop. So every call
 * here fails quietly: a note that cannot be written is simply not kept.
 */
const quiet: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Not kept. Asked for again next time.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Nothing to remove if it could never be written.
    }
  },
};

/** For a `persist` store whose contents are a note and nothing more. */
export const noteStorage = <T,>() => createJSONStorage<T>(() => quiet);
