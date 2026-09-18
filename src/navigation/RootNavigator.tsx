import React from "react";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "@cartze/core/theme";
import { useAuthStore } from "../stores/authStore";
import { SignInScreen } from "../modules/auth/screens/SignInScreen";
import { PartnerTabs } from "./PartnerTabs";
import { BootScreen } from "../modules/auth/screens/BootScreen";
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
    <NavigationContainer theme={navTheme}>
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
