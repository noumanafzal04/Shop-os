import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { shopAvatar, shopInitial, useShopCover } from "../shopCover";
import type { PublicShop } from "../services/marketplaceService";
import { FeaturedTag } from "./FeaturedTag";

/**
 * A SHOP AS A SQUARE TILE — foodpanda's "Popular Shops" row.
 *
 * The shop's mark large and square, its name under it in two lines, and the
 * one fact that decides a tap: how soon. A rail of these reads as a shelf of
 * shops at a glance, which a rail of wide cards with three facts each did not.
 */
export function ShopTile({ shop, onPress }: { shop: PublicShop; onPress: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const coverFor = useShopCover();
  const cover = coverFor(shop.slug);
  const closed = shop.is_open_now === false;
  const prep = shop.prep_time_minutes ?? null;

  return (
    <Touchable style={styles.tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={shop.business_name}>
      <View style={[styles.mark, { backgroundColor: cover.bg }, closed && styles.closed]}>
        <SmartImage
          uri={shopAvatar(shop)}
          resizeMode="contain"
          fallback={shopInitial(shop.business_name)}
          fallbackBackground={cover.bg}
          fallbackColor={cover.fg}
          style={styles.markImg}
        />
        {shop.is_featured === true && <FeaturedTag onImage style={styles.tag} />}
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {shop.business_name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {closed ? "Closed now" : prep !== null ? `From ${prep} min` : shop.city?.name ?? ""}
      </Text>
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    tile: { width: 140, alignItems: "center", gap: 2 },
    mark: {
      width: 140,
      height: 140,
      borderRadius: radius.lg,
      overflow: "hidden",
      marginBottom: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    markImg: { width: "100%", height: "100%" },
    closed: { opacity: 0.55 },
    tag: { position: "absolute", top: 8, left: 8 },
    name: { ...typography.label, color: c.text, textAlign: "center", fontSize: 15, lineHeight: 20 },
    meta: { ...typography.small, color: c.textSecondary, textAlign: "center" },
  });
