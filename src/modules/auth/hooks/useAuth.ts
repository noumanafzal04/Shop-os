import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useAuthStore } from "../../../stores/authStore";
import { authService } from "../services/authService";
import { teardownPush } from "../../../services/push";
import { navigationRef } from "../../../navigation/deepLinks";
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

/**
 * SIGNING OUT — one path, and it ends somewhere.
 *
 * ── Why the side menu had to stop doing its own ──────────────────────
 *
 * There were two sign-outs. The account screen called this hook; the side menu
 * called `authStore.clear()` directly. So which button somebody pressed
 * decided whether the server token was revoked and whether this device stopped
 * receiving push — the menu's version did neither. A token left alive is a
 * session anybody holding the phone can resume, and a device left registered
 * keeps buzzing about a shop its owner has signed out of.
 *
 * ── And why it lands on the sign-in screen ───────────────────────────
 *
 * Clearing the session leaves a GUEST, and a guest may browse the whole app —
 * which is right, and which made signing out look like nothing had happened.
 * The screen did not change; the name in the menu simply went away.
 *
 * So it opens sign-in. As a MODAL, deliberately: it acknowledges the thing
 * that was just done and offers the obvious next step, and anybody who
 * actually wanted to carry on browsing dismisses it and does. A hard redirect
 * would take the shop away from somebody who signed out of one account to use
 * another.
 */
export function useLogout() {
  const endSession = useEndSession();

  return useMutation({
    mutationFn: () => authService.logout(),
    // Local session dies even if the server call failed (offline logout).
    onSettled: endSession,
  });
}

/**
 * SIGN OUT EVERYWHERE — the same ending, a wider server call.
 *
 * Shares `useEndSession` rather than repeating it, because the defect this
 * app has already had once is two buttons that both say "sign out" and mean
 * different things: one revoked the token and dropped the push registration,
 * the other only emptied the store. Whichever the person pressed decided
 * whether their session was really over.
 */
export function useLogoutEverywhere() {
  const endSession = useEndSession();

  return useMutation({
    mutationFn: () => authService.logoutAll(),
    onSettled: endSession,
  });
}

/**
 * WHAT SIGNING OUT ACTUALLY DOES, in one place.
 *
 * Push first: a device left registered keeps buzzing about orders belonging to
 * an account whose owner has left this phone.
 */
function useEndSession() {
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await teardownPush(); // unregister this device from push first
    await clear();
    queryClient.clear();

    // After the store has flipped, so the navigator has already swapped to
    // whatever a guest sees before this lands on top of it.
    if (navigationRef.isReady()) navigationRef.navigate("SignIn", undefined);
  }, [clear, queryClient]);
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
