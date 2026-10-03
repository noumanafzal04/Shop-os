import React from "react";
import { ScrollView, StyleSheet, Text, type ViewStyle } from "react-native";
import { Touchable } from "./Touchable";
import { spacing, typography, useColors, type ThemeColors } from "../theme";

export interface Chip<T extends string> {
  key: T;
  label: string;
  /** Drawn beside the label when present. Zero is a real answer and is shown. */
  count?: number;
}

/**
 * A ROW OF FILTER PILLS — written once because it was written three times.
 *
 * ── The bug this replaces, and why it needed a component ─────────────
 *
 * A horizontal ScrollView dropped straight into a flex column takes the
 * leftover height, and its content container stretches every child to fill it.
 * The partner app had three copies of this bar — order stages, money periods,
 * menu categories — and all three had the defect:
 *
 *   Orders    five pills the height of half the phone
 *   Menu      pills drawn taller than their strip, so each was CLIPPED in half
 *   Money     unharmed, purely because that bar happens to sit inside another
 *             ScrollView where there is no leftover height to take
 *
 * One bug, three copies, visible on two screens and invisible on the third.
 * Fixing it three times is how it comes back a fourth: this product has the
 * scar already — four guards reading one route list, a page rule with two
 * drifted copies. `flexGrow: 0` and `alignItems: "center"` live HERE now, and
 * a bar that does not use this component is the thing to look at.
 *
 * ── The count is drawn even when it is zero ──────────────────────────
 *
 * A missing number beside six that have one reads as "not counted", not as
 * "none". Pass `count: 0` and it says 0.
 */
export function ChipBar<T extends string>({
  items,
  active,
  onPick,
  style,
}: {
  items: Array<Chip<T>>;
  active: T;
  onPick: (key: T) => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const s = styles(c);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Both are load-bearing — see the docblock. Neither is cosmetic.
      style={[s.bar, style]}
      contentContainerStyle={s.row}
      // The bar is the screen's own control and must not steal a vertical drag
      // meant for the list behind it.
      directionalLockEnabled
    >
      {items.map((item) => {
        const on = item.key === active;
        return (
          <Touchable
            key={item.key}
            onPress={() => onPick(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.chip, on ? s.chipOn : null]}
          >
            <Text style={[s.label, on ? s.labelOn : null]} numberOfLines={1}>
              {item.label}
            </Text>
            {item.count != null ? (
              <Text style={[s.count, on ? s.countOn : null]}>{item.count}</Text>
            ) : null}
          </Touchable>
        );
      })}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    bar: { flexGrow: 0 },
    row: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 1,
      /**
       * 999 is safe HERE and banned on small square views.
       *
       * The rule in this product is about 9999 on a view under roughly 40pt,
       * where Fabric rounds it away and the thing renders square. A pill this
       * wide is not that case.
       */
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      // An unselected chip needs an edge, or it disappears into the page —
      // the ground and the inset surface are only about 1.1:1 apart.
      borderWidth: 1,
      borderColor: c.border,
    },
    chipOn: { backgroundColor: c.primary, borderColor: c.primary },
    label: { ...typography.label, fontSize: 13, color: c.textSecondary },
    labelOn: { color: c.onPrimary },
    count: { ...typography.label, fontSize: 13, color: c.textMuted },
    countOn: { color: c.onPrimary, opacity: 0.85 },
  });
