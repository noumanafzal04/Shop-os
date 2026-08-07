import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../../theme";

export type Tone = "brand" | "success" | "warning" | "error" | "info" | "neutral";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: colors.brand[50], fg: colors.brand[600] },
  success: { bg: colors.successBg, fg: "#027a48" },
  warning: { bg: colors.warningBg, fg: "#b54708" },
  error: { bg: colors.errorBg, fg: "#b42318" },
  info: { bg: colors.infoBg, fg: "#175cd3" },
  neutral: { bg: colors.gray[100], fg: colors.gray[600] },
};

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  text: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
});
