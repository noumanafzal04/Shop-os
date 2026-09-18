import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Touchable } from "@cartze/core/ui/Touchable";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import { STATUS_LABEL, type OrderStatus } from "../services/orderStages";
import type { StageCounts } from "../services/ordersService";

/** Left to right in the order an order actually travels. */
const STAGES: Array<OrderStatus | "all"> = [
  "all",
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
];

/**
 * WHICH STAGE THE QUEUE IS SHOWING, AND HOW MANY ARE IN EACH.
 *
 * ── The count is always drawn, including zero ────────────────────────
 *
 * The server computes these with conditional sums rather than a GROUP BY for
 * exactly this reason: a missing key would leave one chip with no number
 * beside six that have one, and "no number" reads as "not counted", not as
 * "none". A shopkeeper glancing at this has to be able to trust that an empty
 * stage says 0 rather than saying nothing.
 */
export function StageBar({
  active,
  counts,
  onPick,
}: {
  active: OrderStatus | "all";
  counts: StageCounts | undefined;
  onPick: (stage: OrderStatus | "all") => void;
}) {
  const c = useColors();
  const s = styles(c);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      // The bar is the screen's own control and must not steal a vertical
      // drag meant for the list behind it.
      directionalLockEnabled
    >
      {STAGES.map((stage) => {
        const on = stage === active;
        const n = counts?.[stage];

        return (
          <Touchable
            key={stage}
            onPress={() => onPick(stage)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.chip, on ? s.chipOn : null]}
          >
            <Text style={[s.label, on ? s.labelOn : null]} numberOfLines={1}>
              {stage === "all" ? "All" : STATUS_LABEL[stage]}
            </Text>
            {n != null ? (
              <Text style={[s.count, on ? s.countOn : null]}>{n}</Text>
            ) : null}
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
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 1,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    /**
     * `borderRadius: 999` is safe HERE and banned on small square views.
     *
     * The rule in this product is about 9999 on a view under about 40pt, where
     * Fabric rounds it away and the thing renders square. A pill this wide is
     * not that case.
     */
    chipOn: { backgroundColor: c.primary },
    label: { ...typography.label, fontSize: 13, color: c.textSecondary },
    labelOn: { color: c.onPrimary },
    count: { ...typography.label, fontSize: 13, color: c.textMuted },
    countOn: { color: c.onPrimary, opacity: 0.85 },
  });
