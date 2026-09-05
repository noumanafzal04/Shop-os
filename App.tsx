/**
 * App root — the shoppers' and riders' app.
 *
 * Providers: SafeArea → Theme → React Query → OfflineBanner + auth-driven
 * navigation. The product's name is never spelled out in a screen; it comes
 * from `src/common/brand.ts`, which is the one place a rename touches.
 *
 * ── Why ThemeProvider being here is a fix and not a tidy-up ────────────
 *
 * It was written, exported, documented, and mounted NOWHERE. So dark mode could
 * not work — not "was switched off", could not work — and `useColors()`, the
 * hook its own docblock calls "the only way a component should learn a colour",
 * threw for anyone who called it. Every screen had quietly settled for the
 * deprecated static light palette instead, which is why nobody noticed.
 *
 * A provider nothing mounts is the same class of thing as a rule stated in a
 * comment and implemented nowhere: it reads as done. `__tests__/theme.test.tsx`
 * now mounts the real tree and asks, so this cannot silently come undone.
 */

import React, { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/common/api/queryClient";
import { OfflineBanner } from "./src/common/ui/OfflineBanner";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { ThemeProvider, useTheme } from "./src/theme";
import { ToastHost } from "./src/common/ui/toast";
import { ConfirmHost } from "./src/common/ui/confirm";
import { prefs } from "./src/common/utils/prefs";
import { useAuthStore } from "./src/stores/authStore";
import { OnboardingScreen } from "./src/modules/onboarding/OnboardingScreen";
import type { ThemePreference } from "./src/theme";

/**
 * The status bar belongs to the theme, not to the file that starts the app.
 * It sits inside the provider because it has to READ the theme to know whether
 * the clock and battery should be drawn dark or light — hardcoded
 * "dark-content" is invisible on a near-black page.
 */
function ThemedChrome() {
  const { isDark, colors } = useTheme();
  return (
    <StatusBar
      barStyle={isDark ? "light-content" : "dark-content"}
      backgroundColor={colors.bg}
    />
  );
}

function App() {
  /**
   * What was saved last time, before the first paint.
   *
   * `null` means "not read yet". The tree waits for it rather than mounting on
   * a default and correcting itself, because that correction is a visible
   * flash of the wrong theme on every cold start — the exact thing somebody
   * who chose dark is choosing dark to avoid. The same read decides whether
   * the introduction has already been through once, so it is ONE round trip.
   */
  const [saved, setSaved] = useState<{ theme: ThemePreference; onboarded: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    /**
     * Both Keychain reads at once.
     *
     * The saved settings gate the first paint and the session gates the
     * splash, and they used to run one after the other: `App` awaited the
     * settings, mounted the tree, and only THEN did `useBootstrapSession`
     * start reading the tokens. Two sequential trips to the Android Keystore
     * were most of the three to four seconds spent on the logo, for two
     * answers that do not depend on each other.
     *
     * The token read's result is kept in the store, and `hydrateTokens`
     * returns immediately when it is already there — so the bootstrap below
     * finds it done rather than doing it again.
     */
    Promise.all([prefs.all(), useAuthStore.getState().hydrateTokens().catch(() => false)]).then(
      ([p]) => {
        if (alive) setSaved({ theme: p.theme ?? "system", onboarded: !!p.onboarded });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // One frame at most on a warm start. Painted in nothing rather than in a
  // guess at the theme.
  if (saved === null) return null;

  return <Rooted saved={saved} />;
}

/**
 * The tree, once the saved settings are known.
 *
 * Split out so `onboarding` can be seeded from what was read — a `useState`
 * beside the read above would have to start on a guess and then be corrected
 * by an effect, which is the same one-frame flash in a different place.
 */
function Rooted({ saved }: { saved: { theme: ThemePreference; onboarded: boolean } }) {
  const [onboarding, setOnboarding] = useState(!saved.onboarded);

  return (
    <SafeAreaProvider>
      {/*
        Follows the phone until somebody says otherwise.

        It was pinned to light for exactly as long as any screen could not leave
        it — a half-dark app, new components dark and the shop white, is worse
        than either theme. `__tests__/darkModeDebt.test.ts` held the pin and the
        debt together, and released both when the last screen migrated.

        The choice now survives a relaunch: see `src/common/utils/prefs.ts` for
        where it is kept and why there.
      */}
      <ThemeProvider
        initialPreference={saved.theme}
        onPreferenceChange={(p) => {
          prefs.setTheme(p).catch(() => {});
        }}
      >
        <QueryClientProvider client={queryClient}>
          <ThemedChrome />
          {/*
            The introduction sits IN FRONT of the app, not before it.

            Everything below stays mounted, so skipping it is a state change
            rather than a navigation — and a deep link that opened the app
            straight onto an order still has that order underneath when the
            person presses Skip.
          */}
          {onboarding ? (
            <OnboardingScreen
              onDone={() => {
                setOnboarding(false);
                prefs.setOnboarded().catch(() => {});
              }}
            />
          ) : (
            <>
              <OfflineBanner />
              <RootNavigator />
            </>
          )}
          <ToastHost />
          <ConfirmHost />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
