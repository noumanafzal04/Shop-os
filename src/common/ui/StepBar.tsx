import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, typography } from "../../theme";

/**
 * Order-flow progress: ① Menu ── ② Cart ── ③ Checkout.
 * Filled up to `active` (1-based), like the reference design.
 */
export function StepBar({ active }: { active: 1 | 2 | 3 }) {
  const steps = ["Menu", "Cart", "Checkout"];
  return (
    <View style={styles.row}>
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n <= active;
        return (
          <React.Fragment key={label}>
            {i > 0 && <View style={[styles.rail, n <= active && styles.railDone]} />}
            <View style={styles.step}>
              <View style={[styles.dot, done && styles.dotDone]}>
                <Text style={[styles.dotText, done && styles.dotTextDone]}>{n}</Text>
              </View>
              <Text style={[styles.label, done && styles.labelDone]}>{label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  step: { alignItems: "center", gap: 3, width: 72 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  dotText: { ...typography.tiny, color: colors.gray[400], fontWeight: "700" },
  dotTextDone: { color: colors.white },
  label: { ...typography.tiny, color: colors.gray[400] },
  labelDone: { color: colors.black, fontWeight: "600" },
  rail: { flex: 1, height: 2, backgroundColor: colors.border, marginTop: 13, maxWidth: 56 },
  railDone: { backgroundColor: colors.brand[500] },
});
