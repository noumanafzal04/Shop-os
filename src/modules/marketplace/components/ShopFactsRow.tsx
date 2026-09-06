import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClockIcon, MapPinIcon, MotorcycleIcon, StarIcon } from "../../../common/ui/icons";
import { useTheme } from "../../../theme";
import { shopFactsShort, type ShopFact } from "../shopFacts";
import type { PublicShop } from "../services/marketplaceService";

/**
 * The facts line under a shop's name.
 *
 * One component because the home row and the shops list were each drawing their
 * own — same star, same rating, same distance, written twice and already
 * differing in whether "Open" appears. Two copies of one line is two lines that
 * will eventually disagree about the same shop on two screens.
 *
 * ── What was wrong with a run-on line ────────────────────────────────
 *
 * "delivery fee, rating, km aik row main hai — text kis tarha lag rhy." Three
 * unrelated facts at 11pt in one grey sentence, dot-separated:
 *
 *     4.5 · 25 min · Rs 150 delivery
 *
 * They are three different KINDS of thing — a judgement, a duration, a price —
 * and running them together makes the eye read a sentence when it wanted to
 * find one number. A dot is the weakest separator there is; it says "these go
 * together", which is the opposite of true here.
 *
 * So each fact gets its own mark and its own space. An icon does two jobs a
 * separator cannot: it says which KIND of fact this is before the number is
 * read, and it lets somebody find the price on eight cards without reading any
 * of the other twenty-four facts.
 *
 * ── And the rating left, because it was on the card twice ────────────
 *
 * `shopFacts()` put the rating first, and the card also drew a rating CHIP
 * beside the shop's name — so every home card carried the same number in two
 * places, three inches apart, in two different sizes. The chip is the better
 * of the two (pinned right, it lines up down the whole list so four shops can
 * be compared without reading four names), so the fact went.
 */

/** A mark per KIND of fact. Null where a glyph would add nothing. */
const MARKS = {
  prep: ClockIcon,
  distance: MapPinIcon,
  fee: MotorcycleIcon,
  threshold: MotorcycleIcon,
  rating: StarIcon,
} as const;

export function ShopFactsRow({
  shop,
  limit = 3,
  closed = false,
}: {
  shop: PublicShop;
  limit?: number;
  /** Shown as the LAST fact — it changes what the others are worth. */
  closed?: boolean;
}) {
  const { colors: c, typography } = useTheme();
  const facts = shopFactsShort(shop, limit);

  if (facts.length === 0 && !closed) return null;

  return (
    <View style={styles.row}>
      {facts.map((f: ShopFact) => {
        const Mark = MARKS[f.key as keyof typeof MARKS];
        const tint = f.tone === "offer" ? c.success : c.textSecondary;

        return (
          <View key={f.key} style={styles.fact}>
            {Mark != null && <Mark size={12} color={tint} />}
            <Text
              numberOfLines={1}
              style={[typography.tiny, { color: tint }, f.tone === "offer" && styles.offer]}
            >
              {f.text}
            </Text>
          </View>
        );
      })}

      {closed && (
        <View style={[styles.fact, styles.shut, { backgroundColor: c.errorBg }]}>
          <Text style={[typography.tiny, styles.offer, { color: c.error }]}>Closed</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * WRAPPING, not clipping.
   *
   * It was `nowrap` with a shrink, so on a narrow card the last fact was cut
   * off mid-word — "Rs 150 deliv" — which reads as a broken layout rather than
   * as a list that ran out of room. Three facts at this size fit one line on
   * anything wider than a rail card, and when they do not, the second line is
   * the honest outcome.
   */
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 6 },
  // 4 between a mark and its number, 10 between facts — so a fact reads as one
  // thing before the row reads as three.
  fact: { flexDirection: "row", alignItems: "center", gap: 4 },
  offer: { fontWeight: "700" },
  shut: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 },
});
