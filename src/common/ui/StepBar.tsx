import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, type ThemeColors, typography, useColors } from "../../theme";

/**
 * Order-flow progress: ① Menu ── ② Cart ── ③ Checkout.
 * Filled up to `active` (1-based), like the reference design.
 */
export function StepBar({ active }: { active: 1 | 2 | 3 }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
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

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  step: { alignItems: "center", gap: 3, width: 72 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  dotText: { ...typography.tiny, color: c.gray[400], fontWeight: "700" },
  dotTextDone: { color: c.white },
  label: { ...typography.tiny, color: c.gray[400] },
  labelDone: { color: c.text, fontWeight: "600" },
  rail: { flex: 1, height: 2, backgroundColor: c.border, marginTop: 13, maxWidth: 56 },
  railDone: { backgroundColor: c.brand[500] },
});
