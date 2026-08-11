import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { homeForRole } from "../../../common/routing/guards";
import type { LoginPayload } from "../types";

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (payload: LoginPayload) => authService.login(payload),
    onSuccess: ({ data }) => {
      setAuth(data.user, data.access_token, data.refresh_token);
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
