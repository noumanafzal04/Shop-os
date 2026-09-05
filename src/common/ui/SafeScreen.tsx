import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../../theme";

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
  backgroundColor,
}: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  // Defaulted HERE, not in the parameter list: a default cannot read a hook.
  //
  // And it defaults to the page background rather than white. White was
  // defensible while the app could only be light; on a dark phone it paints a
  // white sheet behind every screen and the insets flash white on every
  // navigation.
  const ground = backgroundColor ?? c.bg;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: ground,
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

// Not a function of the palette: the only rule here is `flex: 1`, and a
// stylesheet rebuilt on every theme change to produce the same object is
// ceremony. The colour this screen needs is the one it computes above.
const styles = StyleSheet.create({
  root: { flex: 1 },
});
