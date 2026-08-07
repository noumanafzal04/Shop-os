import { create } from "zustand";
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
