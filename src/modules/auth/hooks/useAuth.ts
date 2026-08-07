import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { teardownPush } from "../../../services/push";
import type { LoginPayload } from "../types";

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    mutationFn: (payload: LoginPayload) => authService.login(payload),
    onSuccess: async ({ data }) => {
      // Navigation reacts to the store flipping to "authenticated".
      await setAuth(data.user, data.access_token, data.refresh_token);
    },
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.logout(),
    // Local session dies even if the server call failed (offline logout).
    onSettled: async () => {
      await teardownPush(); // unregister this device from push first
      await clear();
      queryClient.clear();
    },
  });
}

/**
 * App-boot session restore: hydrate tokens from Keychain → fetch /me.
 * Ends in "authenticated" or "guest" — RootNavigator switches on it.
 */
export function useBootstrapSession() {
  const bootstrap = useCallback(async () => {
    const { hydrateTokens, setUser, setGuest, clear } = useAuthStore.getState();

    const hasTokens = await hydrateTokens();
    if (!hasTokens) {
      setGuest();
      return;
    }

    try {
      const { data } = await authService.me();
      setUser(data);
      useAuthStore.setState({ status: "authenticated" });
    } catch {
      // Dead/expired session (refresh already attempted by the client).
      await clear();
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
}
