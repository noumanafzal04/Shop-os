import { create } from "zustand";
import { configureAuth } from "@cartze/core/api/client";
import { secureStorage } from "../common/utils/secureStorage";
import type { SessionUser } from "../types/session";

/**
 * "booting" is the state before the Keychain has answered. It is a separate
 * state from "guest" on purpose: showing the sign-in screen for the half
 * second it takes to read a stored token is how an app that remembers you
 * looks like an app that does not.
 */
export type AuthStatus = "booting" | "authenticated" | "guest";

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  accessToken: string | null;
  refreshToken: string | null;

  setAuth: (user: SessionUser, access: string, refresh: string) => Promise<void>;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setUser: (user: SessionUser) => void;
  setGuest: () => void;
  clear: () => Promise<void>;
  hydrateTokens: () => Promise<boolean>;
  /** Does the signed-in person hold this permission? */
  can: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "booting",
  user: null,
  accessToken: null,
  refreshToken: null,

  setAuth: async (user, accessToken, refreshToken) => {
    await secureStorage.saveTokens({ accessToken, refreshToken });
    set({ user, accessToken, refreshToken, status: "authenticated" });
  },

  setTokens: async (accessToken, refreshToken) => {
    await secureStorage.saveTokens({ accessToken, refreshToken });
    set({ accessToken, refreshToken });
  },

  setUser: (user) => set({ user }),

  setGuest: () => set({ status: "guest" }),

  clear: async () => {
    await secureStorage.clearTokens();
    set({ user: null, accessToken: null, refreshToken: null, status: "guest" });
  },

  /**
   * Read the stored session back at boot.
   *
   * Returns whether there was one. The tokens are put in place but the status
   * is NOT set to "authenticated" here: a stored access token may be an hour
   * old and long dead, and an app that trusts it paints a whole dashboard of
   * empty states before the first 401 arrives. `App.tsx` calls `/auth/me` and
   * lets the answer decide.
   */
  hydrateTokens: async () => {
    const tokens = await secureStorage.getTokens();
    if (!tokens) {
      set({ status: "guest" });
      return false;
    }

    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  },

  /**
   * One question, asked the same way everywhere.
   *
   * The owner is not exempt by a role check — the server grants an owner every
   * permission, so asking the list is both simpler and correct. A role test
   * here would be a second source of truth for the same fact, and this product
   * has no job roles by design: cashier, waiter and kitchen are permission
   * SETS.
   */
  can: (permission) => get().user?.permissions?.includes(permission) ?? false,
}));

/**
 * THE API CLIENT ASKS; THIS STORE ANSWERS.
 *
 * `@cartze/core`'s axios client cannot import a store — it is shared, and a
 * store is an app's own. So the client states what it needs (four functions)
 * and each app supplies them from wherever its session lives. The customer app
 * has its own copy of this; neither learns anything about the other.
 *
 * Functions rather than values, deliberately: an interceptor runs long after
 * this was called and must read the tokens AS THEY ARE THEN. Handing over
 * values would freeze the session at boot, and every request after the first
 * refresh would carry a dead token.
 */
export function wireAuthToApi(): void {
  configureAuth({
    accessToken: () => useAuthStore.getState().accessToken,
    refreshToken: () => useAuthStore.getState().refreshToken,
    setTokens: (access, refresh) => useAuthStore.getState().setTokens(access, refresh),
    clear: () => useAuthStore.getState().clear(),
  });
}
