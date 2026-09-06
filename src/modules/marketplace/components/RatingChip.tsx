import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { StarIcon } from "../../../common/ui/icons";
import { spacing, type ThemeColors, typography, useColors } from "../../../theme";

/**
 * HOW GOOD A SHOP IS, IN THE SAME PLACE ON EVERY CARD.
 *
 * ── Why a chip and not a fact in the line ────────────────────────────
 *
 * The rating was the first entry in `shopFacts()`, which put it third in a
 * grey run-on sentence — and two of the four cards ALSO drew it as a chip, so
 * the same number appeared twice on one card at two sizes.
 *
 * The chip is the better of the two, and the reason is comparison. Pinned to
 * the right of the name, four shops' ratings line up in a column and can be
 * read against each other without reading four shop names. The same number
 * buried between a prep time and a delivery fee cannot be compared with
 * anything — the eye has to find it on each card first.
 *
 * So it is a chip everywhere, from one component, and no longer a fact at all.
 *
 * ── And it says nothing rather than nothing-shaped ───────────────────
 *
 * A shop with no reviews yet renders NULL. It does not render "0.0", or an
 * empty star, or a dash — a new shop is not a bad shop, and the one thing this
 * app must not do is make a shop that has just opened look like one people
 * have judged and rejected.
 */

interface Props {
  rating: number | null | undefined;
  /**
   * `plate` sits on a photograph — a solid surface chip, so it stays legible
   * over whatever colour is behind it. `soft` sits on a card, where the amber
   * tint is enough and a white chip would be a hole.
   */
  variant?: "soft" | "plate";
  /** Absolute positioning for the cover-band case. */
  style?: object;
}

export function RatingChip({ rating, variant = "soft", style }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  if (rating == null) return null;

  return (
    <View style={[styles.chip, variant === "plate" && styles.plate, style]}>
      <StarIcon size={11} color={c.warm} />
      <Text style={[styles.text, variant === "plate" && styles.plateText]}>
        {rating.toFixed(1)}
      </Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.warmSoft,
      // An explicit radius, not `radius.full`: a very large radius renders as
      // a square on small views under the new architecture.
      borderRadius: 9,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    text: { ...typography.tiny, color: c.onWarm, fontWeight: "800", fontSize: 11 },
    plate: { backgroundColor: c.surface },
    plateText: { color: c.text },
  });

/** The gap a card leaves between its name and this chip. */
export const RATING_GAP = spacing.sm;
