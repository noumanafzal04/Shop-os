import React from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useTheme } from "../../../theme";
import type { HomeBanner } from "../services/marketplaceService";

/**
 * The promo strip at the top of the home screen.
 *
 * ── The shape, and why it is fixed ─────────────────────────────────────
 *
 * One card per screen, 2:1, snapping. The strip it replaced was a row of
 * 300×130 cards that scrolled freely, which meant a banner was almost never
 * fully on screen: whoever paid for it got a slice of it, cropped differently
 * on every phone.
 *
 * 2:1 is also what the artwork is commissioned at — 1200×600, which covers a
 * 3× screen at any phone width we care about. A single stated ratio is what
 * lets an advertiser send one file instead of asking what size.
 *
 * ── When the shop has sold no banners ──────────────────────────────────
 *
 * The strip does not vanish; it carries the app's own placeholders. An empty
 * band at the top of a home screen reads as a failed image load, and a home
 * screen whose layout changes depending on whether anyone bought an advert is
 * a home screen nobody can design against.
 *
 * Those placeholders say true things about the product and never invent an
 * offer or a shop — a fabricated "50% off at ..." is an advertisement for
 * something that does not exist, and it would be indistinguishable from a real
 * one to the person reading it.
 */

const RATIO = 2; // width : height

interface Placeholder {
  id: string;
  title: string;
  body: string;
  emoji: string;
  tone: "brand" | "warm" | "ink";
}

const PLACEHOLDERS: Placeholder[] = [
  {
    id: "ph-delivery",
    title: "Shops near you",
    body: "Order from the ones that already know your street",
    emoji: "🛵",
    tone: "brand",
  },
  {
    id: "ph-cod",
    title: "Pay when it arrives",
    body: "Cash on delivery, every order",
    emoji: "💵",
    tone: "warm",
  },
  {
    id: "ph-everything",
    title: "Food, grocery, medicine",
    body: "One basket, one delivery",
    emoji: "🧺",
    tone: "ink",
  },
];

export function PromoCarousel({
  banners,
  onPress,
}: {
  banners: HomeBanner[];
  onPress: (banner: HomeBanner) => void;
}) {
  const { colors: c, radius, spacing, typography } = useTheme();
  const { width } = useWindowDimensions();

  const cardWidth = width - spacing.md * 2;
  const cardHeight = Math.round(cardWidth / RATIO);
  const stride = cardWidth + spacing.sm;

  const [page, setPage] = React.useState(0);
  const showing: Array<HomeBanner | Placeholder> = banners.length > 0 ? banners : PLACEHOLDERS;

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / stride));
  };

  const toneOf = (tone: Placeholder["tone"]) =>
    tone === "warm"
      ? { bg: c.warm, fg: c.onWarm }
      : tone === "ink"
        ? { bg: c.ink, fg: c.textInverse }
        : { bg: c.primary, fg: c.onPrimary };

  return (
    <View style={{ marginTop: spacing.lg }}>
      <FlatList
        horizontal
        data={showing}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        // Paged rather than free: a half-scrolled advert is one nobody paid for.
        snapToInterval={stride}
        decelerationRate="fast"
        disableIntervalMomentum
        onMomentumScrollEnd={onSettled}
        contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
        renderItem={({ item }) => {
          const size = { width: cardWidth, height: cardHeight, borderRadius: radius.lg };

          if ("image_url" in item) {
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title ?? "Promotion"}
                onPress={() => onPress(item)}
                style={[styles.card, size, { backgroundColor: c.surfaceAlt }]}
              >
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={size} resizeMode="cover" />
                ) : (
                  // A banner whose artwork failed still has to be tappable and
                  // still has to be the right SIZE, or the row reflows around
                  // a hole every time a CDN is slow.
                  <View style={[styles.fallback, size, { backgroundColor: c.primarySoft, padding: spacing.lg }]}>
                    <Text style={[typography.h3, { color: c.primary }]} numberOfLines={3}>
                      {item.title ?? ""}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }

          const { bg, fg } = toneOf(item.tone);
          return (
            <View
              // Not a button: it advertises the app to the person already
              // holding it, so there is nowhere for a tap to go.
              accessible
              accessibilityLabel={`${item.title}. ${item.body}`}
              style={[styles.card, styles.placeholder, size, { backgroundColor: bg, padding: spacing.lg }]}
            >
              <Text style={styles.emoji}>{item.emoji}</Text>
              <View style={styles.copy}>
                <Text style={[typography.title, { color: fg }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[typography.small, styles.body, { color: fg }]} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {showing.length > 1 && (
        <View style={[styles.dots, { marginTop: spacing.sm }]}>
          {showing.map((item, i) => (
            <View
              key={item.id}
              // The current page is a BAR, not just a darker dot: on a small
              // screen a colour change alone is not a difference anyone
              // notices, and colour alone is never an accessible cue.
              style={[
                styles.dot,
                i === page ? styles.dotOn : styles.dotOff,
                { backgroundColor: i === page ? c.primary : c.border },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  fallback: { alignItems: "flex-start", justifyContent: "center" },
  placeholder: { flexDirection: "row", alignItems: "center", gap: 14 },
  emoji: { fontSize: 42 },
  copy: { flex: 1 },
  body: { opacity: 0.9, marginTop: 4 },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  dot: { height: 6, borderRadius: 3 },
  dotOn: { width: 18 },
  dotOff: { width: 6 },
});
