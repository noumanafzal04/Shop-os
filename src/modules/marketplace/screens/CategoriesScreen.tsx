import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { Touchable } from "../../../common/ui/Touchable";
import { EmptyState } from "../../../common/ui/EmptyState";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { Skeleton } from "../../../common/ui/Skeleton";
import { ChevronRightIcon, StorefrontIcon } from "../../../common/ui/icons";
import { useLocationStore } from "../../../stores/locationStore";
import { useHomeFeed } from "../hooks/useMarketplace";
import { SHORTCUTS, tradeIcon } from "../tradeIcon";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

/**
 * EVERY KIND OF SHOP, ON ONE PAGE.
 *
 * ── Why this screen exists ───────────────────────────────────────────
 *
 * The home screen shows the trades as a wrapping grid of tiles. That works
 * while there are eight of them; it is the whole top half of the screen at
 * fourteen, and it is the first thing between somebody and the shops they
 * came for.
 *
 * So home keeps the first eight and links here, and here is the full list with
 * room to say something about each one — how many shops are actually in it,
 * which is the fact that decides whether tapping it is worth doing.
 *
 * ── One request, already made ────────────────────────────────────────
 *
 * `useHomeFeed` is the SAME query the home screen ran, with the same key, so
 * opening this screen costs nothing: react-query hands over the cached feed
 * and this page paints immediately. A dedicated endpoint would have been a
 * second list of trades to keep in step with the first, and a spinner on a
 * screen that is one tap deep.
 *
 * ── The labels are not ours ──────────────────────────────────────────
 *
 * `label` comes from the server. The app used to build one by capitalising the
 * code, which is why a mart read "Mart" while every other surface in the
 * product has called it "Mart & Grocery" for months.
 */
export function CategoriesScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  /**
   * The SAME geo the home screen passes, because that is what makes this a
   * cache hit rather than a second request. `useHomeFeed`'s query key includes
   * the coordinates — read them differently here and this screen would spin
   * while the answer sat in the cache under another key.
   */
  const { lat, lng } = useLocationStore();

  const feed = useHomeFeed({ lat: lat ?? undefined, lng: lng ?? undefined });
  const types = feed.data?.business_types ?? [];

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="All categories" />

      {feed.isError ? (
        <LoadFailed
          what="the categories"
          error={feed.error}
          onRetry={() => feed.refetch()}
          retrying={feed.isFetching}
        />
      ) : (
        <FlatList
          data={types}
          keyExtractor={(t) => t.type}
          contentContainerStyle={listStyle(styles)}
          ListHeaderComponent={
            /**
             * The four filters first, as a row of their own.
             *
             * They are not trades — "Offers" is not a kind of shop — so they
             * do not belong in the same list. They are the four things people
             * come to a marketplace for regardless of trade, and burying them
             * under fourteen categories would be hiding the shortcuts behind
             * the long way round.
             */
            <>
              <Text style={styles.caption}>Ways to shop</Text>
              <View style={styles.quick}>
                {SHORTCUTS.map(({ key, label, icon: Icon, tone, filters }) => (
                  <Touchable
                    key={key}
                    style={styles.quickTile}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    onPress={() => navigation.navigate("Browse", { title: label, filters })}
                  >
                    <View
                      style={[
                        styles.quickIcon,
                        // Solid amber for offers, the brand tint for the rest —
                        // the same pairing the home tiles use, because a pale
                        // glyph on a paler tile measured 1.3:1 and vanished.
                        { backgroundColor: tone === "offer" ? c.warm : c.brand[100] },
                      ]}
                    >
                      <Icon size={22} color={tone === "offer" ? c.onWarm : c.primary} />
                    </View>
                    <Text style={styles.quickLabel} numberOfLines={2}>
                      {label}
                    </Text>
                  </Touchable>
                ))}
              </View>
              <Text style={styles.caption}>Shop by category</Text>
            </>
          }
          ListEmptyComponent={
            feed.isLoading ? (
              <View style={styles.skeletons}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <View key={i} style={styles.skeletonRow}>
                    <Skeleton width={48} height={48} borderRadius={16} />
                    <View style={styles.skeletonCopy}>
                      <Skeleton width={130} height={13} borderRadius={4} />
                      <Skeleton width={70} height={10} borderRadius={4} />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                icon={StorefrontIcon}
                tone="warm"
                title="No shops near you yet"
                message="We are signing shops up. Set your location to somewhere we already cover to have a look around."
                action={{ label: "Change location", onPress: () => navigation.navigate("Location") }}
              />
            )
          }
          renderItem={({ item }) => {
            const Icon = tradeIcon(item.type);

            return (
              <Touchable
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}, ${item.shops_count} shops`}
                /**
                 * The SAME destination the home tile has: `ShopList`, filtered
                 * to this trade. Two ways in, one screen — a second listing
                 * screen for the same rows is how one of them ends up with a
                 * fix the other never gets.
                 */
                onPress={() =>
                  navigation.navigate("ShopList", {
                    business_type: item.type,
                    title: item.label,
                  })
                }
              >
                <View style={styles.rowIcon}>
                  <Icon size={22} color={c.primary} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {/*
                    The count, in words. It is the reason to tap or not tap,
                    and "1 shops" is the kind of detail that makes an app feel
                    unfinished for the sake of two characters.
                  */}
                  <Text style={styles.rowMeta}>
                    {item.shops_count} {item.shops_count === 1 ? "shop" : "shops"}
                  </Text>
                </View>
                <ChevronRightIcon size={16} color={c.textMuted} />
              </Touchable>
            );
          }}
        />
      )}
    </SafeScreen>
  );
}

/** Memo-free because it depends on nothing but the styles object itself. */
const listStyle = (styles: ReturnType<typeof makeStyles>) => [styles.list, styles.grow];

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md, gap: spacing.xs },
    /** So the empty state has a screen to centre in — a content container is
     *  only as tall as its content. */
    grow: { flexGrow: 1 },

    caption: {
      ...typography.tiny,
      color: c.textMuted,
      fontWeight: "700",
      letterSpacing: 0.4,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },

    quick: { flexDirection: "row", marginBottom: spacing.md },
    quickTile: { width: "25%", alignItems: "center", gap: 6 },
    quickIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    quickLabel: {
      ...typography.tiny,
      color: c.textSecondary,
      fontWeight: "600",
      textAlign: "center",
    },

    /**
     * A ROW, not a tile.
     *
     * The home screen's grid is for a handful of the most-used trades, where
     * the icon is the whole affordance. A full list is read, so it gets a name
     * that can be as long as it needs to be and a count beside it — neither of
     * which fits under a 56pt square.
     */
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: 12,
    },
    rowIcon: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: c.brand[100],
      alignItems: "center",
      justifyContent: "center",
    },
    rowCopy: { flex: 1, gap: 2 },
    rowTitle: { ...typography.label, color: c.text, fontSize: 15 },
    rowMeta: { ...typography.tiny, color: c.textMuted },

    skeletons: { gap: spacing.xs },
    skeletonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: 12,
    },
    skeletonCopy: { flex: 1, gap: 6 },
  });
