import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import type { Period } from "../services/moneyService";

/**
 * WHICH STRETCH OF TIME THE FIGURES COVER.
 *
 * `tax_year` is Pakistan's — 1 July to 30 June — and it is offered beside the
 * calendar year rather than instead of it, because a shopkeeper asks both
 * questions and they have different answers. It is not a setting: a shop does
 * not choose which tax year the FBR uses.
 */
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
  { key: "yearly", label: "This year" },
  { key: "tax_year", label: "Tax year" },
];

export function PeriodBar({ active, onPick }: { active: Period; onPick: (p: Period) => void }) {
  const c = useColors();
  const s = styles(c);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      directionalLockEnabled
    >
      {PERIODS.map((p) => {
        const on = p.key === active;
        return (
          <Touchable
            key={p.key}
            onPress={() => onPick(p.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.chip, on ? s.chipOn : null]}
          >
            <Text style={[s.label, on ? s.labelOn : null]}>{p.label}</Text>
          </Touchable>
        );
      })}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    chipOn: { backgroundColor: c.primary },
    label: { ...typography.label, fontSize: 13, color: c.textSecondary },
    labelOn: { color: c.onPrimary },
  });
