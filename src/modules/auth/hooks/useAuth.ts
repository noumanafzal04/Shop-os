import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { homeForRole } from "../../../common/routing/guards";
import { ensureDatabaseBelongsTo } from "../../offline/db/tillOwner";
import type { LoginPayload } from "../types";
import { disablePush } from "../../../services/webPush";
import { believedAt, stillStands } from "../../../common/kept/kept";
import { stampNow } from "../../../common/kept/shellStamp";
import { useKeptStore } from "../../../common/kept/keptStore";

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (payload: LoginPayload) => authService.login(payload),
    onSuccess: ({ data }) => {
      setAuth(data.user, data.access_token, data.refresh_token);
      // THE MOMENT OF HANDOVER, and the earliest one there is.
      //
      // The pull checks this too, and that is what makes it airtight — but a
      // pull happens after the shop's screens have already rendered, and the
      // till reads its catalog from this database. Doing it here means the
      // first thing a new shop sees is its own shelf, not the last shop's.
      //
      // Not awaited: sign-in must not wait on IndexedDB, and the pull that
      // follows a few seconds later performs the identical check.
      void ensureDatabaseBelongsTo(data.user.tenant?.id ?? null).catch(() => undefined);
      // Land each role on its home: /admin · /tenant · / (storefront).
      navigate(homeForRole(data.user.role), { replace: true });
    },
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    /**
     * The push token goes FIRST, while the session still exists.
     *
     * `DELETE /devices` needs the bearer that is about to be thrown away, and
     * a token left registered means this browser keeps buzzing about a shop
     * whoever is holding it has just signed out of. On a shared phone that is
     * somebody else's orders.
     *
     * Awaited but never allowed to fail the sign-out: a network hiccup must
     * not trap somebody in a session they asked to leave.
     */
    mutationFn: async () => {
      await disablePush();

      return authService.logout();
    },
    // Local session dies regardless of whether the server call succeeded.
    onSettled: () => {
      clear();
      queryClient.clear();
      // What the shell kept for this person goes with them (common/kept).
      useKeptStore.getState().forget();
      navigate("/signin", { replace: true });
    },
  });
}

/**
 * Change your own password.
 *
 * The server keeps THIS device signed in and revokes every other one, so the
 * local token stays valid and there is nothing to re-store here. Queries are
 * left alone deliberately: nothing about the data on screen has changed.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: {
      current_password: string;
      password: string;
      password_confirmation: string;
    }) => authService.changePassword(payload),
  });
}

/** How long the last "who am I" is trusted without asking again. */
export const ME_TRUSTED_FOR = 5 * 60 * 1000;

/**
 * Fresh profile from the server (auth store holds the cached copy).
 *
 * ── It starts from that copy, aged honestly ──────────────────────────
 *
 * Every shop screen calls this, so every load asked "who am I" — including
 * the load a second after signing in, when the answer had just arrived with
 * the token. The auth store already keeps the person between loads; it now
 * keeps WHEN the server last said so (`userAt`), and inside
 * `ME_TRUSTED_FOR` that is the answer. Past it the screen opens from the copy
 * and asks behind it, exactly as before.
 *
 * Saving the shop's own details still asks at once (`invalidateQueries` on
 * this key); so does the server saying that something this is made of has
 * changed — a module switched on by an admin, a permission by the owner
 * (`kept/shellStamp.ts`). A copy whose clock is in the future is not believed
 * (`believedAt`).
 */
export function useMe(enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const { data } = await authService.me();
      setUser(data, true, stampNow());
      return data;
    },
    enabled: enabled && isAuthenticated,
    staleTime: ME_TRUSTED_FOR,
    initialData: () => {
      const { user, userAt } = useAuthStore.getState();

      return user !== null && userAt !== null ? user : undefined;
    },
    initialDataUpdatedAt: () => {
      const { userAt, userUnder } = useAuthStore.getState();
      if (userAt === null) return undefined;

      // Heard under a stamp the server has since moved on from: shown, and
      // asked about at once.
      return stillStands(userUnder, stampNow()) ? believedAt(userAt, Date.now()) : 0;
    },
  });
}
