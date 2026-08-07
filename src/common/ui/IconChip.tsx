import React from "react";
import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radius } from "../../theme";

/**
 * Rounded tinted container for a lucide icon — the little accent square
 * used on stat cards, list rows and empty states.
 */
export function IconChip({
  icon: Icon,
  size = 44,
  tint = colors.brand[500],
  bg = colors.brand[50],
}: {
  icon: LucideIcon;
  size?: number;
  tint?: string;
  bg?: string;
}) {
  return (
    <View style={[styles.chip, { width: size, height: size, backgroundColor: bg }]}>
      <Icon size={size * 0.5} color={tint} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
