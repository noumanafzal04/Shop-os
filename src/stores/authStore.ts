import { create } from "zustand";
import { configureAuth } from "../common/api/client";
import { secureStorage } from "../common/utils/secureStorage";
import type { User } from "../modules/auth/types";

/**
 * Auth state machine:
 *   booting → (tokens found + /me ok) → authenticated
 *           → (no tokens / dead tokens) → guest
 *
 * Tokens are persisted ONLY in the Keychain; this store keeps them in memory
 * for the request interceptor.
 */
export type AuthStatus = "booting" | "authenticated" | "guest";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, accessToken: string, refreshToken: string) => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  setUser: (user: User) => void;
  setGuest: () => void;
  clear: () => Promise<void>;
  hydrateTokens: () => Promise<boolean>;
  hasPermission: (permission: string) => boolean;
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

  /** Load tokens from the Keychain into memory. True if tokens exist. */
  hydrateTokens: async () => {
    // Already in memory: skip the round trip.
    //
    // This is called twice on a cold start — once by `App`, to run it
    // ALONGSIDE the saved-settings read rather than after it, and once by
    // `useBootstrapSession`. The Keychain is not free, and two sequential
    // reads were most of the wait on the splash screen.
    if (get().accessToken) return true;

    const tokens = await secureStorage.getTokens();
    if (!tokens) return false;
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  },

  hasPermission: (permission) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === "super_admin" || user.role === "shop_owner") return true;
    return user.permissions.includes(permission);
  },
}));

/**
 * HANDS THE HTTP LAYER ITS TOKENS, once, at boot.
 *
 * `common/api/client.ts` used to import this store. It worked, and it was one
 * of three imports keeping the shared layer tied to this app — a store about
 * a CUSTOMER's session, inside a file that otherwise knows only HTTP.
 *
 * Inverted rather than moved: the client states what it needs (four
 * functions) and this store supplies them. The second app supplies its own,
 * from its own store, and neither app learns anything about the other.
 *
 * Functions rather than values, deliberately — an interceptor runs long after
 * this was called and must read the tokens AS THEY ARE THEN. Handing over
 * values would freeze the session at boot and every request after the first
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
