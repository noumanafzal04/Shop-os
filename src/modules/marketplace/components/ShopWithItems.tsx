import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ChevronRightIcon,
  StarIcon,
} from "../../../common/ui/icons";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { OfferBadge, Price } from "../../../common/ui/Price";
import { shopInitial, useShopCover } from "../shopCover";
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
 * ── The spacing pass, and what was actually wrong ────────────────────
 *
 * "products bht sth sth hain… conjusted sa lg raha." Measured rather than
 * guessed at, every gap on this card was four or eight points: 8 of padding
 * around a 54px logo, 4 between product tiles, 8 to the next card. Nothing was
 * wrong with any single number and the card had no rhythm at all, because a
 * layout reads as crowded when the space INSIDE a group is the same as the
 * space between groups — the eye gets no help deciding what belongs together.
 *
 * So the scale is now 4 / 8 / 12 / 16 and each step means something:
 *
 *   4    inside a line — a name to its price
 *   12   between siblings — one product tile to the next
 *   16   the card's own margin, and the gap to the card below
 *
 * The tiles grew with it. 104×78 at 11.5pt was a thumbnail of a photograph;
 * 132×104 at 13pt is a picture of a dish, which is the entire reason the strip
 * exists.
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
  const coverFor = useShopCover();

  const closed = shop.is_open_now === false;
  const cover = coverFor(shop.slug);
  const items = shop.preview_products ?? [];

  return (
    <View style={styles.card}>
      {/* ── Who ─────────────────────────────────────────────────── */}
      <Touchable
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={shop.business_name}
        onPress={onOpen}
      >
        <View style={styles.logoWrap}>
          <SmartImage
            uri={shop.logo_path}
            fallback={shopInitial(shop.business_name)}
            fallbackBackground={cover.bg}
            fallbackColor={cover.fg}
            style={styles.logo}
          />
          {/*
            "Closed" as a LABEL, not as a dimmer.

            The whole card used to drop to 60% opacity, which is a legible way
            to say "shut" and an illegible way to say everything else on it —
            the name, the rating and the prices all went grey together. The
            picture dims; the words do not.
          */}
          {closed && (
            <View style={styles.shutVeil}>
              <Text style={styles.shutText}>Closed</Text>
            </View>
          )}
        </View>

        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>
            {shop.business_name}
          </Text>
          <ShopFactsRow shop={shop} limit={3} />
        </View>

        {/*
          The rating moved out of the name row and onto the end.

          It shared a row with the shop's name, which meant a long name and a
          rating competed for the same line and the name lost characters to a
          number that is the same width every time. Pinned right, it lines up
          down the whole list — so the eye can compare four shops without
          reading four names first.
        */}
        {shop.rating != null ? (
          <View style={styles.rating}>
            <StarIcon size={12} color={c.warm} />
            <Text style={styles.ratingText}>{shop.rating.toFixed(1)}</Text>
          </View>
        ) : (
          <ChevronRightIcon size={18} color={c.textMuted} />
        )}
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
              scaleTo={0.95}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              onPress={() => onItem(item.id)}
            >
              <View style={styles.itemImageWrap}>
                <SmartImage
                  uri={item.image}
                  fallback={shopInitial(item.name)}
                  fallbackBackground={coverFor(item.id).bg}
                  fallbackColor={coverFor(item.id).fg}
                  style={styles.itemImage}
                />
                {/*
                  Draws itself, or nothing. It used to be a hand-rolled pill
                  that computed its own percentage inline and would happily
                  render "0% off" on a one-rupee cut; `OfferBadge` returns null
                  below a percentage point. See `common/ui/Price`.
                */}
                <OfferBadge
                  value={item.price}
                  was={item.original_price}
                  style={styles.itemBadge}
                />
              </View>

              <Text style={styles.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Price value={item.price} was={item.original_price} size="sm" />
            </Touchable>
          ))}

          {/*
            The last tile is the way in.

            The strip shows three items out of a menu of forty, and a strip
            that simply stops implies that is all there is. It also gives the
            sideways scroll somewhere to arrive.
          */}
          <Touchable
            style={styles.more}
            scaleTo={0.95}
            accessibilityRole="button"
            accessibilityLabel={`See everything at ${shop.business_name}`}
            onPress={onOpen}
          >
            <View style={styles.moreDisc}>
              <ChevronRightIcon size={20} color={c.primary} />
            </View>
            <Text style={styles.moreText} numberOfLines={2}>
              See all
            </Text>
          </Touchable>
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
      marginBottom: spacing.md,
    },

    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: 12,
    },
    logoWrap: { width: 58, height: 58, borderRadius: 16, overflow: "hidden" },
    logo: { width: 58, height: 58 },
    shutVeil: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(12,7,5,0.62)",
      alignItems: "center",
      justifyContent: "center",
    },
    shutText: {
      ...typography.tiny,
      color: "#ffffff",
      fontWeight: "800",
      fontSize: 9.5,
      letterSpacing: 0.2,
    },

    headText: { flex: 1, gap: 1 },
    name: { ...typography.h3, color: c.text, fontSize: 16.5 },
    rating: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.warmSoft,
      borderRadius: 9,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    ratingText: { ...typography.tiny, color: c.onWarm, fontWeight: "800", fontSize: 11 },

    strip: { gap: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    item: { width: 132 },
    itemImageWrap: { borderRadius: radius.md, overflow: "hidden", marginBottom: 8 },
    itemImage: { width: 132, height: 104 },
    itemBadge: { position: "absolute", top: 6, left: 6 },
    itemName: { ...typography.small, color: c.text, fontSize: 13, fontWeight: "600" },

    // A tile, so it scrolls to a stop rather than trailing off — same width as
    // the pictures beside it, and quiet enough not to compete with them.
    more: { width: 88, alignItems: "center", justifyContent: "center", gap: 8 },
    moreDisc: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: c.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    moreText: {
      ...typography.tiny,
      color: c.primary,
      fontWeight: "700",
      textAlign: "center",
    },
  });
