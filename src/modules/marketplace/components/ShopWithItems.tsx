import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Star } from "lucide-react-native";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { money } from "../../../common/format";
import { shopCover, shopInitial } from "../shopCover";
import { ShopFactsRow } from "./ShopFactsRow";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import type { PublicShop } from "../services/marketplaceService";

/**
 * A SHOP, AND A FEW OF THE THINGS IT SELLS.
 *
 * ── Why the plain row was not enough ─────────────────────────────────
 *
 * The home screen's long tail was a list of shop NAMES. That is a directory,
 * and a directory asks somebody to open four shops to find out which one has
 * what they want. Three thumbnails of the actual items answers the question on
 * the card — which is how anybody chooses between two burger places without
 * opening either.
 *
 * ── The items are tappable, and they go somewhere specific ───────────
 *
 * Pressing a dish opens the shop WITH that dish's sheet already up. Pressing
 * anywhere else opens the shop. Those are two different intentions and it
 * would be a waste of a thumbnail to treat them the same.
 *
 * ── A shop with nothing listed still gets a card ─────────────────────
 *
 * The strip disappears and the header stands on its own, exactly as the old
 * row did. A card that collapses to nothing because a shop has not uploaded
 * photographs yet would punish the newest shops hardest.
 */

interface Props {
  shop: PublicShop;
  onOpen: () => void;
  onItem: (productId: string) => void;
  /** Position in the list, for the entrance stagger. */
  index?: number;
}

export function ShopWithItems({ shop, onOpen, onItem }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);

  const closed = shop.is_open_now === false;
  const cover = shopCover(shop.slug);
  const items = shop.preview_products ?? [];

  return (
    <View style={[styles.card, closed && styles.closed]}>
      {/* ── Who ─────────────────────────────────────────────────── */}
      <Touchable
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={shop.business_name}
        onPress={onOpen}
      >
        <SmartImage
          uri={shop.logo_path}
          fallback={shopInitial(shop.business_name)}
          fallbackBackground={cover.bg}
          fallbackColor={cover.fg}
          style={styles.logo}
        />

        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {shop.business_name}
            </Text>
            {shop.rating != null && (
              <View style={styles.rating}>
                <Star size={11} color={c.warm} fill={c.warm} strokeWidth={0} />
                <Text style={styles.ratingText}>{shop.rating.toFixed(1)}</Text>
              </View>
            )}
          </View>
          <ShopFactsRow shop={shop} closed={closed} />
        </View>
      </Touchable>

      {/* ── What ────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          // The card's own press must not fight a sideways drag through the
          // items — without this, a scroll that starts on a thumbnail opens
          // the shop instead.
          keyboardShouldPersistTaps="handled"
        >
          {items.map((item) => (
            <Touchable
              key={item.id}
              style={styles.item}
              scaleTo={0.94}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onItem(item.id)}
            >
              <SmartImage
                uri={item.image}
                fallback={shopInitial(item.name)}
                fallbackBackground={shopCover(item.id).bg}
                fallbackColor={shopCover(item.id).fg}
                style={styles.itemImage}
              />
              {item.original_price != null && (
                <View style={styles.cut}>
                  <Text style={styles.cutText}>
                    {Math.round((1 - item.price / item.original_price) * 100)}% off
                  </Text>
                </View>
              )}
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{money(item.price)}</Text>
                {item.original_price != null && (
                  <Text style={styles.was}>{money(item.original_price)}</Text>
                )}
              </View>
            </Touchable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
      marginBottom: spacing.sm,
    },
    closed: { opacity: 0.6 },

    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    logo: { width: 54, height: 54, borderRadius: radius.md },
    headText: { flex: 1, gap: 3 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: { ...typography.label, color: c.text, fontSize: 15.5, flexShrink: 1 },
    rating: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.warmSoft,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    ratingText: { ...typography.tiny, color: c.onWarm, fontWeight: "800", fontSize: 10.5 },

    strip: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
    item: { width: 104 },
    itemImage: { width: 104, height: 78, borderRadius: radius.md, marginBottom: 5 },
    cut: {
      position: "absolute",
      top: 5,
      left: 5,
      backgroundColor: c.primary,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    cutText: { ...typography.tiny, color: c.onPrimary, fontWeight: "800", fontSize: 9.5 },
    itemName: { ...typography.tiny, color: c.text, fontSize: 11.5, fontWeight: "600" },
    priceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
    price: { ...typography.tiny, color: c.primary, fontWeight: "800", fontSize: 11.5 },
    was: {
      ...typography.tiny,
      color: c.gray[400],
      fontSize: 10,
      textDecorationLine: "line-through",
    },
  });
