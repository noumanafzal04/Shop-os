import React from "react";
import { StatusBar, type StatusBarStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";

/**
 * Per-screen status bar that only applies while its screen is focused —
 * tab screens stay mounted, so a plain <StatusBar> would leak its style
 * to sibling tabs. Colored headers use light icons; light screens dark.
 */
export function FocusedStatusBar({
  style,
  background,
}: {
  style: StatusBarStyle;
  background?: string;
}) {
  const focused = useIsFocused();
  if (!focused) return null;
  return <StatusBar barStyle={style} backgroundColor={background} animated />;
}
