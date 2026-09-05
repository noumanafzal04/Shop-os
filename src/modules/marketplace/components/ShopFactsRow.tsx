import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Star } from "lucide-react-native";
import { useTheme } from "../../../theme";
import { shopFactsShort } from "../shopFacts";
import type { PublicShop } from "../services/marketplaceService";

/**
 * The facts line under a shop's name.
 *
 * One component because the home row and the shops list were each drawing their
 * own — same star, same rating, same distance, written twice and already
 * differing in whether "Open" appears. Two copies of one line is two lines that
 * will eventually disagree about the same shop on two screens.
 *
 * The star's amber comes from the theme now. It was `#f5a623` in both files,
 * which is the kind of literal that survives a repalette and then sits next to
 * a colour scheme it no longer belongs to.
 */
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
  const { colors: c, typography, spacing } = useTheme();
  const facts = shopFactsShort(shop, limit);

  if (facts.length === 0 && !closed) return null;

  return (
    <View style={[styles.row, { gap: spacing.sm, marginTop: 5 }]}>
      {facts.map((f, i) => (
        <View key={f.key} style={styles.fact}>
          {f.key === "rating" && (
            <Star size={12} color={c.warm} fill={c.warm} strokeWidth={0} />
          )}
          <Text
            numberOfLines={1}
            style={[
              typography.tiny,
              { color: f.tone === "offer" ? c.warm : c.textSecondary },
              f.tone === "offer" && styles.offer,
            ]}
          >
            {f.text}
          </Text>
          {/* A separator between facts, never trailing one. */}
          {i < facts.length - 1 && (
            <Text style={[typography.tiny, { color: c.textMuted }]}>·</Text>
          )}
        </View>
      ))}

      {closed && (
        <>
          {/* A separator, because "Rs 150 delivery Closed" is one run-on
              sentence and the facts before it already carry one. */}
          {facts.length > 0 && (
            <Text style={[typography.tiny, { color: c.textMuted }]}>·</Text>
          )}
          <Text style={[typography.tiny, styles.offer, { color: c.error }]}>Closed</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The card is 240 wide and the facts are as long as the shop's fee makes
  // them. Without a shrink the row runs past the card's own edge and the last
  // fact is cut off mid-word by the card BESIDE it — which reads as a broken
  // layout rather than as a list that ran out of room.
  row: { flexDirection: "row", alignItems: "center", flexWrap: "nowrap", flexShrink: 1 },
  fact: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 },
  offer: { fontWeight: "700" },
});
