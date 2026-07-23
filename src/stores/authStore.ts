import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../modules/auth/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user) => set({ user }),

      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),

      // Mirrors backend User::hasPermission — scope owners hold everything.
      hasPermission: (permission) => {
        const user = get().user;
        if (!user) return false;
        if (user.role === "super_admin" || user.role === "shop_owner") return true;
        return user.permissions.includes(permission);
      },
    }),
    { name: "shopos-auth" },
  ),
);
