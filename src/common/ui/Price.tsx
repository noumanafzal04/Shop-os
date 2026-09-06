import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { money } from "../format";
import { spacing, type ThemeColors, typography, useColors } from "../../theme";

/**
 * A PRICE, AND WHAT IT USED TO BE.
 *
 * ── Why this is a component and not four style blocks ────────────────
 *
 * "Rs 250, Rs 300 struck through" was written seven times across this app and
 * had already drifted into five different designs: the strike was `gray[400]`
 * in three files and `textMuted` in a fourth; the sale price was `c.primary`
 * on the home card, `c.brand[600]` in the deals rail, `c.text` on the shop
 * page; two screens built the string with `"Rs " + n.toLocaleString()` by hand
 * rather than through `money()`, which is the copy `format.ts` exists to
 * prevent. Nobody decided any of that — it is what happens when a shape is
 * re-typed instead of imported.
 *
 * ── The rule the copies all stated and none enforced ──────────────────
 *
 * Every one of them drew the strike-through on `original_price != null`. The
 * comment beside the field says the opposite — "only when there IS a cut, a
 * strike-through against the same number lies" — and nothing checked. A shop
 * that fills in a regular price equal to its selling price got
 *
 *     Rs 300  R̶s̶ ̶3̶0̶0̶
 *
 * which reads as an offer, is not one, and would be the app's fault rather
 * than the shop's. So the comparison lives HERE, once: a `was` that is not
 * genuinely higher is not shown at all.
 *
 * ── And the percentage is computed in one place too ───────────────────
 *
 * `Math.round((1 - price / was) * 100)` sat inline on the home card, where a
 * one-rupee cut on a two-hundred-rupee item rounds to `0% off` — a badge
 * announcing nothing. `percentOff` returns null below the threshold instead,
 * so a caller cannot draw a badge that says nothing.
 */

/**
 * The cut, as a whole number — or null when there is not really one.
 *
 * Null covers three cases that all end the same way: no regular price, a
 * regular price that is not higher, and a cut too small to round to a
 * percentage anybody would care about.
 */
export function percentOff(
  value: string | number | null | undefined,
  was: string | number | null | undefined,
): number | null {
  const now = Number(value ?? NaN);
  const before = Number(was ?? NaN);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  if (before <= now || before <= 0) return null;

  const pct = Math.round((1 - now / before) * 100);
  return pct >= 1 ? pct : null;
}

/** True when `was` is a real regular price above what is being charged. */
export function hasCut(
  value: string | number | null | undefined,
  was: string | number | null | undefined,
): boolean {
  const now = Number(value ?? NaN);
  const before = Number(was ?? NaN);
  return Number.isFinite(now) && Number.isFinite(before) && before > now;
}

/**
 * Three sizes, because a price appears on a 128px tile, in a list row and at
 * the top of a product sheet — and those want different type, not different
 * RULES. The sizes are the only thing a caller chooses.
 */
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { now: number; was: number }> = {
  sm: { now: 13, was: 11 },
  md: { now: 15, was: 12.5 },
  lg: { now: 20, was: 14 },
};

interface Props {
  value: string | number | null | undefined;
  /** The regular price. Drawn only when it is genuinely higher. */
  was?: string | number | null;
  size?: Size;
  /**
   * Sale prices in the brand colour.
   *
   * Off by default: on a tile that already carries an amber offer badge, a red
   * price is a second thing shouting about the same fact. It is on where the
   * price is the only signal there is — the deals rail, the product sheet.
   */
  tone?: "text" | "brand";
}

export function Price({ value, was, size = "sm", tone = "text" }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const scale = SIZES[size];
  const cut = hasCut(value, was);

  return (
    <View style={styles.row}>
      <Text
        style={[
          styles.now,
          { fontSize: scale.now },
          tone === "brand" && { color: c.primary },
        ]}
        numberOfLines={1}
      >
        {money(value)}
      </Text>
      {cut && (
        <Text style={[styles.was, { fontSize: scale.was }]} numberOfLines={1}>
          {money(was)}
        </Text>
      )}
    </View>
  );
}

interface BadgeProps {
  /** What it is selling for now. */
  value: string | number | null | undefined;
  /** What it normally sells for. */
  was?: string | number | null;
  /**
   * A percentage the SERVER worked out, for the endpoints that send one.
   *
   * The deals rail is scored and sorted server-side by `percent_off`, and a
   * badge that recomputed it from two rounded rupee figures could disagree with
   * the ordering of the very list it sits in.
   */
  percent?: number | null;
  style?: object;
}

/**
 * The amber chip that says how much is off.
 *
 * AMBER, not the brand red. The palette is explicit that warm is "offers,
 * ratings, the selected tab — never a button", and red is what every button in
 * this app is drawn in. Three of these badges were red, which put the page's
 * call-to-action colour on a label nobody can press, on top of a photograph,
 * beside a real red button.
 *
 * Renders nothing when there is no genuine cut, so a caller can hand it any
 * product without asking first.
 */
export function OfferBadge({ value, was, percent, style }: BadgeProps) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const pct = percent != null && percent >= 1 ? Math.round(percent) : percentOff(value, was);
  if (pct == null) return null;

  return (
    <View style={[styles.badge, style]}>
      <Text style={styles.badgeText}>{pct}% OFF</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "baseline", gap: 5 },
    now: { ...typography.label, color: c.text, fontWeight: "800" },
    was: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "500",
      textDecorationLine: "line-through",
    },

    badge: {
      backgroundColor: c.warm,
      // An explicit radius, not `radius.full`: a very large radius renders as a
      // square on small views under the new architecture, and this view is 18
      // points tall.
      borderRadius: 7,
      paddingHorizontal: 6,
      paddingVertical: 2.5,
    },
    badgeText: {
      ...typography.tiny,
      color: c.onWarm,
      fontWeight: "800",
      fontSize: 9.5,
      letterSpacing: 0.2,
    },
  });

/** Kept for the rare caller that needs the gap value the row uses. */
export const PRICE_GAP = spacing.xs + 1;
