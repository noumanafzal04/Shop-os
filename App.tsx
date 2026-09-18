/**
 * CartZe Partner — the root.
 *
 * In order: safe-area, theme, react-query, then the navigator, with the toast
 * and confirm hosts above everything so a message can appear over a modal.
 *
 * ── What this app does NOT have ──────────────────────────────────────
 *
 * A mode switch. The customer app swaps its whole navigator between shopping
 * and riding; a shopkeeper has one hat. `ModeSwitchCover`, `modeStore` and the
 * two-palette logic do not come across — this app passes no `paletteFor`, so
 * `ThemeProvider` uses its default, which is the shopping side's green.
 */
import React, { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@cartze/core/api/queryClient";
import { configureApi } from "@cartze/core/api/client";
import { ThemeProvider, useTheme, type ThemePreference } from "@cartze/core/theme";
import { ToastHost } from "@cartze/core/ui/toast";
import { ConfirmHost } from "@cartze/core/ui/confirm";
import { OfflineBanner } from "@cartze/core/ui/OfflineBanner";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { useAuthStore, wireAuthToApi } from "./src/stores/authStore";
import { authService } from "./src/modules/auth/services/authService";
import { prefs } from "./src/common/utils/prefs";
import { API_BASE_URL } from "./src/common/config";

/**
 * MODULE SCOPE, BEFORE THE COMPONENT — and both lines matter.
 *
 * `configureApi` hands the shared client its base URL. Without it the axios
 * instance ships with an empty `baseURL` and every request goes out as a
 * RELATIVE path, which on a phone is nowhere. The customer app proved this
 * silently: deleting the call broke no test, no type check and no lint.
 *
 * `wireAuthToApi` hands it the four session functions. Neither belongs inside
 * a component — a request made during the first render would find an
 * unconfigured client.
 */
configureApi({ baseUrl: API_BASE_URL });
wireAuthToApi();

function ThemedChrome() {
  const { name, colors } = useTheme();

  return (
    <StatusBar
      barStyle={name === "dark" ? "light-content" : "dark-content"}
      backgroundColor={colors.bg}
    />
  );
}

export default function App() {
  const [saved, setSaved] = useState<{ theme: ThemePreference } | null>(null);
  const hydrateTokens = useAuthStore((s) => s.hydrateTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const setGuest = useAuthStore((s) => s.setGuest);

  useEffect(() => {
    let alive = true;

    (async () => {
      const stored = await prefs.all();
      if (alive) setSaved({ theme: stored.theme ?? "system" });

      /**
       * A STORED TOKEN IS NOT A SESSION.
       *
       * An access token lives one hour, so the one in the Keychain is usually
       * dead. Trusting it would paint the whole dashboard, then replace it
       * with the sign-in screen when the first 401 came back — which reads as
       * the app logging you out at random. `/auth/me` is asked once, and its
       * answer is what decides.
       *
       * The refresh interceptor inside the shared client gets its chance
       * here too: if the access token has expired but the refresh token has
       * not, this call succeeds and the session is simply restored.
       */
      const had = await hydrateTokens();
      if (!had || !alive) return;

      try {
        const me = await authService.me();
        if (alive) {
          setUser(me.data);
          useAuthStore.setState({ status: "authenticated" });
        }
      } catch {
        // Refused, or offline with nothing cached. Either way this person
        // signs in again; `clear()` already ran inside the interceptor if the
        // refresh itself was rejected.
        if (alive) setGuest();
      }
    })();

    return () => {
      alive = false;
    };
  }, [hydrateTokens, setUser, setGuest]);

  // Hold the first paint until the saved theme is known. One frame of the
  // wrong theme is worse than one frame of nothing.
  if (!saved) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider
        initialPreference={saved.theme}
        onPreferenceChange={(p) => {
          void prefs.setTheme(p);
        }}
      >
        <QueryClientProvider client={queryClient}>
          <ThemedChrome />
          <OfflineBanner />
          <RootNavigator />
          <ToastHost />
          <ConfirmHost />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
