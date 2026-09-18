import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { spacing, typography, useColors, type ThemeColors } from "@cartze/core/theme";
import type { Icon } from "@cartze/core/ui/icons";

interface Props {
  label: string;
  value: string;
  icon?: Icon;
  /** Signed %, or null when there is nothing honest to compare against. */
  delta?: number | null;
  /** For a figure where UP is bad — expenses, refunds. */
  invert?: boolean;
  tone?: "plain" | "warn";
}

/**
 * ONE FIGURE, WITH ITS NAME ABOVE IT AND ITS CHANGE BESIDE IT.
 *
 * ── Why the label is above the number ────────────────────────────────
 *
 * Reading order. A shopkeeper scanning this is asking "what am I looking at"
 * before "how much", and a number with its caption underneath makes them read
 * it twice. It also stops the layout shifting: the label is one line always,
 * the number is the part that grows.
 *
 * ── A null delta is HIDDEN, not printed as zero ──────────────────────
 *
 * The server sends null when yesterday was zero, because there is no honest
 * percentage against nothing. Drawing "+100%" on a shop's first day, or "0%"
 * when there is nothing to compare, is a number the app invented.
 */
export function StatTile({ label, value, icon: Glyph, delta, invert, tone = "plain" }: Props) {
  const c = useColors();
  const s = styles(c);

  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;

  return (
    <View style={[s.tile, tone === "warn" ? s.warn : null]}>
      <View style={s.head}>
        {Glyph ? <Glyph size={16} color={c.textMuted} /> : null}
        <Text style={s.label} numberOfLines={1}>
          {label}
        </Text>
      </View>

      <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>

      {delta != null ? (
        <Text style={[s.delta, good ? s.deltaGood : s.deltaBad]}>
          {delta > 0 ? "+" : ""}
          {Math.round(delta)}% vs yesterday
        </Text>
      ) : null}
    </View>
  );
}

const styles = (c: ThemeColors) =>
  StyleSheet.create({
    tile: {
      flex: 1,
      minWidth: 140,
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: spacing.md,
      gap: 6,
    },
    warn: { borderColor: c.warning, backgroundColor: c.warningBg },
    head: { flexDirection: "row", alignItems: "center", gap: 6 },
    label: { ...typography.small, color: c.textSecondary, flexShrink: 1 },
    /**
     * 26pt, and it shrinks rather than wraps.
     *
     * A shop that takes Rs 1,240,000 in a day and one that takes Rs 900 get
     * the same tile, and "Rs 1,240,000" wrapping onto two lines is how a row
     * of tiles ends up different heights. `adjustsFontSizeToFit` with a floor
     * of 0.75 keeps the biggest realistic figure on one line and still legible.
     */
    value: { ...typography.title, fontSize: 26, color: c.text },
    delta: { ...typography.tiny, fontSize: 12 },
    deltaGood: { color: c.success },
    deltaBad: { color: c.error },
  });
