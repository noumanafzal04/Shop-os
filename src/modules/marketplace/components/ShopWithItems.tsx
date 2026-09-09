import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  ChevronRightIcon,
} from "../../../common/ui/icons";
import { Touchable } from "../../../common/ui/Touchable";
import { SmartImage } from "../../../common/ui/SmartImage";
import { OfferBadge, Price } from "../../../common/ui/Price";
import { shopInitial, useShopCover } from "../shopCover";
import { ShopFactsRow } from "./ShopFactsRow";
import { RatingChip } from "./RatingChip";
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
 *
 * ── AND A SHOP WITH ONE OR TWO THINGS LISTED ─────────────────────────
 *
 * Reported as "jab kisi shop ki 1 ya 2 products hoti hain to achi nahi show ho
 * rahi". The strip is a horizontal scroller of FIXED 132pt tiles plus an 88pt
 * "See all", so one item measured 232pt inside a 358pt card: a third of the
 * card was empty and the See-all tile floated in the middle of it, which reads
 * as a layout that failed rather than as a shop with one dish.
 *
 * Under three items there is nothing to scroll, so the tiles stop being fixed
 * and share the row instead — one item fills half the card beside See all, two
 * fill a third each. Same tiles, same heights, no gap. At three or more the
 * horizontal strip is correct again, because then there IS more than fits.
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
  /**
   * Three is the number the strip needs to make sense: 3 × 132 plus the gaps
   * and the See-all tile is already wider than any phone, so it genuinely
   * scrolls. Below that it never did — it just left a hole.
   */
  const scrolls = items.length >= 3;

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
          <RatingChip rating={shop.rating} />
        ) : (
          <ChevronRightIcon size={18} color={c.textMuted} />
        )}
      </Touchable>

      {/* ── What ────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <Strip scrolls={scrolls} styles={styles}>
          {items.map((item) => (
            <Touchable
              key={item.id}
              style={[styles.item, !scrolls && styles.share]}
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
                  style={[styles.itemImage, !scrolls && styles.itemImageShare]}
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
            style={[styles.more, !scrolls && styles.share]}
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
        </Strip>
      )}
    </View>
  );
}

/**
 * The container the tiles sit in — a scroller, or a row that shares the width.
 *
 * One component rather than two copies of the tile markup: the alternative was
 * `{scrolls ? <ScrollView>…</ScrollView> : <View>…</View>}` with the whole
 * `items.map` written twice, which is how one branch quietly stops getting the
 * fix the other gets.
 */
function Strip({
  scrolls,
  styles,
  children,
}: {
  scrolls: boolean;
  styles: ReturnType<typeof makeStyles>;
  children: React.ReactNode;
}) {
  if (!scrolls) return <View style={[styles.strip, styles.row]}>{children}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      // The card's own press must not fight a sideways drag through the items
      // — without this, a scroll that starts on a thumbnail opens the shop
      // instead.
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
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

    strip: { gap: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    /** Only when it is not a scroller — a `contentContainerStyle` is already a
     *  row, and a plain View is not. */
    row: { flexDirection: "row" },
    item: { width: 132 },
    /**
     * An equal share of the row instead of a fixed width. `width: undefined`
     * is load-bearing: `item`'s 132 would otherwise win the flex-basis and
     * leave the same gap this exists to close.
     */
    share: { width: undefined, flex: 1 },
    itemImageWrap: { borderRadius: radius.md, overflow: "hidden", marginBottom: 8 },
    itemImage: { width: 132, height: 104 },
    itemImageShare: { width: "100%" },
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
