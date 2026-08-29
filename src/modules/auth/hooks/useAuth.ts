import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { homeForRole } from "../../../common/routing/guards";
import { ensureDatabaseBelongsTo } from "../../offline/db/tillOwner";
import type { LoginPayload } from "../types";

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
    mutationFn: () => authService.logout(),
    // Local session dies regardless of whether the server call succeeded.
    onSettled: () => {
      clear();
      queryClient.clear();
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

/**
 * Fresh profile from the server (auth store holds the cached copy).
 */
export function useMe(enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const { data } = await authService.me();
      setUser(data);
      return data;
    },
    enabled: enabled && isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}
