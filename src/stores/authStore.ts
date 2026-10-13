import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../modules/auth/types";

interface AuthState {
  user: User | null;
  /**
   * When the SERVER last said who this is — this device's clock.
   *
   * `user` is the kept answer to "who am I, and what does my shop have";
   * this is its age, so a screen that opens a moment after the last one does
   * not ask again (`useMe`). Stamped only by an answer from the server: a
   * screen that patches the copy it holds has not been told anything.
   */
  userAt: number | null;
  /**
   * The server's stamp when it last said who this is (kept/shellStamp).
   * Null when it sent none, and then `userAt` alone says how old the copy is.
   */
  userUnder: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  /**
   * `heard` — the server just said so, as opposed to a screen patching its own
   * copy; `under` is the stamp it said it under.
   */
  setUser: (user: User, heard?: boolean, under?: string | null) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      userAt: null,
      userUnder: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      // Signing in is answered before there is anybody to stamp an answer
      // for, so it is kept under no stamp and judged by its age.
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, userAt: Date.now(), userUnder: null, accessToken, refreshToken, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user, heard = false, under = null) => set(heard ? { user, userAt: Date.now(), userUnder: under } : { user }),

      clear: () =>
        set({
          user: null,
          userAt: null,
          userUnder: null,
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
