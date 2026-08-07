import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../theme";

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Which notch/home-indicator edges to pad. Default: all devices safe. */
  edges?: Array<"top" | "bottom">;
  backgroundColor?: string;
}

/**
 * Every screen's outermost wrapper. Handles notches (Dynamic Island, punch
 * holes) at the top and the home indicator / gesture bar at the bottom on
 * ALL devices — screens never hand-tune insets.
 */
export function SafeScreen({
  children,
  style,
  edges = ["top", "bottom"],
  backgroundColor = colors.white,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor,
          paddingTop: edges.includes("top") ? insets.top : 0,
          paddingBottom: edges.includes("bottom") ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
