import React, { useEffect, useRef } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  type NavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "@cartze/core/theme";
import { useAuthStore } from "../stores/authStore";
import { SignInScreen } from "../modules/auth/screens/SignInScreen";
import { PartnerTabs } from "./PartnerTabs";
import { BootScreen } from "../modules/auth/screens/BootScreen";
import { setPushTapHandler, startPush } from "../services/push";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * SIGNED IN OR NOT — and a third state before either is known.
 *
 * "booting" renders its own screen rather than falling through to sign-in.
 * Showing the sign-in form for the half second the Keychain takes to answer is
 * how an app that remembers you looks like an app that does not, and people
 * start typing before it disappears.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const { name, colors } = useTheme();
  const navRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  /**
   * PUSH STARTS AFTER SIGN-IN, NEVER BEFORE.
   *
   * Registering a device token needs a session — a token registered against
   * nobody is a push nobody receives. And the tap handler is set HERE because
   * this is the only place that holds the navigator: a notification tapped
   * from a cold start has to land on the order, not on the dashboard.
   */
  useEffect(() => {
    if (status !== "authenticated") return;

    let stop: (() => void) | null = null;
    let alive = true;

    setPushTapHandler((orderId) => {
      // Through the tab, then the stack inside it. Navigating straight to
      // `OrderDetail` would work by accident today and break the first time
      // another stack gains a screen with that name.
      /**
       * Nested, and cast once at the boundary.
       *
       * React Navigation cannot type a route that lives three navigators down
       * from this ref, and the honest options are a cast here or a param list
       * that restates every nested stack. The cast is ONE line, next to the
       * screen names it depends on, rather than a second copy of the tree.
       */
      (
        navRef.current?.navigate as
          | ((name: string, params: Record<string, unknown>) => void)
          | undefined
      )?.("Tabs", {
        screen: "Orders",
        params: { screen: "OrderDetail", params: { id: orderId } },
      });
    });

    void startPush().then((teardown) => {
      if (alive) stop = teardown;
      else teardown();
    });

    return () => {
      alive = false;
      stop?.();
      setPushTapHandler(null);
    };
  }, [status]);

  const navTheme = {
    ...(name === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(name === "dark" ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  if (status === "booting") return <BootScreen />;

  return (
    <NavigationContainer ref={navRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {status === "authenticated" ? (
          <Stack.Screen name="Tabs" component={PartnerTabs} />
        ) : (
          <Stack.Screen name="SignIn" component={SignInScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
