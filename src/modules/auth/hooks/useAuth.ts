import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { teardownPush } from "../../../services/push";
import type { LoginPayload } from "../types";

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    // Reported by the screen itself — the sign-in form puts the reason under the password field — so the global
    // toast would say the same thing twice, in two shapes, one of
    // them floating over the form the person is still reading.
    // See `queryClient.ts`.
    meta: { silent: true },
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

    // A Keychain read that throws is a phone that cannot answer, not a
    // decision — and it must not be the reason the app never opens.
    const hasTokens = await hydrateTokens().catch(() => false);
    if (!hasTokens) {
      setGuest();
      return;
    }

    /**
     * OPEN FIRST, confirm second.
     *
     * This used to hold `status: "booting"` — the splash screen — until
     * `/auth/me` answered. An access token lives one hour, so a cold start the
     * next morning is: `me()` 401s after up to 20 seconds, the client then
     * spends up to another 20 refreshing, and the app sits on its own logo for
     * the whole of it with nothing to press. Measured at three minutes on a
     * slow connection.
     *
     * Tokens on the phone are enough to open the app. The profile arrives when
     * it arrives, and if the session turns out to be dead `clear()` drops the
     * person to guest — visible, reversible, and while they were already
     * browsing rather than watching a splash.
     */
    useAuthStore.setState({ status: "authenticated" });

    try {
      const { data } = await authService.me();
      setUser(data);
    } catch {
      // Dead/expired session (refresh already attempted by the client).
      await clear();
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
}
