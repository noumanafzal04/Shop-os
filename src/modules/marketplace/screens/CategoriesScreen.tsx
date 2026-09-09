import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BRAND } from "../../../common/brand";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { ScreenHeader } from "../../../common/ui/ScreenHeader";
import { Touchable } from "../../../common/ui/Touchable";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { Skeleton } from "../../../common/ui/Skeleton";
import { ChevronRightIcon } from "../../../common/ui/icons";
import { useLocationStore } from "../../../stores/locationStore";
import { useCategories } from "../hooks/useMarketplace";
import type { CategoryTrade } from "../services/marketplaceService";
import { SHORTCUTS } from "../tradeIcon";
import { shortcutArt, tradeArt, useTileGround } from "../tileArt";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";

/**
 * EVERY KIND OF SHOP, ON ONE PAGE — TRADE AND CATEGORY.
 *
 * ── Why this screen exists ───────────────────────────────────────────
 *
 * The home screen shows four trade tiles, which is as many as belong above the
 * shops somebody came for. This is the rest of it, and it goes one level
 * deeper than home can: a trade, then the categories inside it.
 *
 * That second level is the point. CartZe sells garments, footwear,
 * electronics, mobile accessories, cosmetics and toys — and all six are
 * `business_category` values inside ONE trade called "Retail Store". A page
 * that stopped at the trade offered a shopper looking for clothes a row
 * labelled Retail Store and no way to say what they meant.
 *
 * ── Its own request, not a slice of home ─────────────────────────────
 *
 * `useCategories` asks a different question than `useHomeFeed`: home returns
 * the trades that HAVE shops, ordered by how many, and this page has to name
 * the ones nobody has joined yet as well. Reusing home's list is what made an
 * "All categories" page that showed exactly the same four rows the home screen
 * already had.
 *
 * ── A row leads somewhere or it does not offer ───────────────────────
 *
 * One rule, everywhere on this page: `shops_count > 0` decides whether a thing
 * can be tapped. A trade or a category with none is drawn muted and presses
 * nowhere, because a chip that opens an empty list is the shape this codebase
 * keeps finding — offered, and not doable. The count is on the row for the
 * same reason: it is the fact that decides whether tapping is worth it.
 */
export function CategoriesScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const ground = useTileGround();

  /**
   * The city, not the pin.
   *
   * The counts are a question about a place ("how many garment shops are
   * there"), and a shopper who has moved two streets has not changed the
   * answer. Passing coordinates would key the cache to every GPS reading and
   * re-ask the same question all day.
   */
  const { city } = useLocationStore();
  const list = useCategories({ city_id: city?.id });

  const types = list.data?.business_types ?? [];
  const anyShops = types.some((t) => t.shops_count > 0);

  const openTrade = React.useCallback(
    (t: CategoryTrade) =>
      navigation.navigate("ShopList", { business_type: t.type, title: t.label }),
    [navigation],
  );

  const openCategory = React.useCallback(
    (t: CategoryTrade, value: string, label: string) =>
      navigation.navigate("ShopList", {
        /**
         * BOTH, on purpose. The trade scopes the deals strip on that screen,
         * so a Garments list shows garment offers rather than whatever the
         * marketplace has discounted today.
         */
        business_type: t.type,
        business_category: value,
        title: label,
      }),
    [navigation],
  );

  if (list.isError) {
    return (
      <SafeScreen backgroundColor={c.bg}>
        <ScreenHeader title="All categories" />
        <LoadFailed
          what="the categories"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen backgroundColor={c.bg}>
      <ScreenHeader title="All categories" />

      <FlatList
        data={types}
        keyExtractor={(t) => t.type}
        contentContainerStyle={listStyle(styles)}
        ListHeaderComponent={
          <>
            {/*
              The four filters first, as a row of their own.

              They are not trades — "Offers" is not a kind of shop — so they do
              not belong in the same list. They are the four things people come
              to a marketplace for regardless of trade, and burying them under
              nine categories would be hiding the shortcuts behind the long way
              round.
            */}
            <Text style={styles.caption}>WAYS TO SHOP</Text>
            <View style={styles.quick}>
              {SHORTCUTS.map(({ key, label, icon: Icon, tone, filters }) => {
                const art = shortcutArt(key);

                return (
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
                        {
                          backgroundColor: art
                            ? ground(art)
                            // Solid amber for offers, the brand tint for the
                            // rest — a pale glyph on a paler tile measured
                            // 1.3:1 and vanished.
                            : tone === "offer"
                              ? c.warm
                              : c.brand[100],
                        },
                      ]}
                    >
                      {art ? (
                        <art.Art size={28} />
                      ) : (
                        <Icon size={22} color={tone === "offer" ? c.onWarm : c.primary} />
                      )}
                    </View>
                    <Text style={styles.quickLabel} numberOfLines={2}>
                      {label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>

            {/*
              WHY THE PAGE IS STILL FULL WHEN THE MARKETPLACE IS EMPTY.

              A shopper in a city we have not signed anybody up in yet gets
              every trade drawn muted plus this line, rather than one empty
              state where the whole page should be. The breadth is the useful
              part of the answer — the app sells all of this, just not here
              yet — and the one thing they can do about it is a tap away.
            */}
            {!list.isLoading && !anyShops && (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  No shops near you yet. Everything below is what {BRAND.name} covers — set
                  your location to a city we already serve to have a look around.
                </Text>
                <Touchable
                  accessibilityRole="button"
                  accessibilityLabel="Change location"
                  onPress={() => navigation.navigate("Location")}
                >
                  <Text style={styles.noticeAction}>Change location</Text>
                </Touchable>
              </View>
            )}

            <Text style={styles.caption}>SHOP BY CATEGORY</Text>

            {list.isLoading &&
              [0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <Skeleton width={48} height={48} borderRadius={16} />
                  <View style={styles.skeletonCopy}>
                    <Skeleton width={130} height={13} borderRadius={4} />
                    <Skeleton width={70} height={10} borderRadius={4} />
                  </View>
                </View>
              ))}
          </>
        }
        renderItem={({ item }) => (
          <TradeSection
            trade={item}
            styles={styles}
            c={c}
            ground={ground}
            onOpenTrade={openTrade}
            onOpenCategory={openCategory}
          />
        )}
      />
    </SafeScreen>
  );
}

/**
 * ONE TRADE: a heading, then the categories inside it as a grid.
 *
 * ── What this replaced, and why ──────────────────────────────────────
 *
 * It was a bordered card per trade with the categories as text chips wrapped
 * underneath. Reported as "view all categories view is not looks good", and it
 * was: on a marketplace this size most chips read zero, so the page was a
 * column of boxes full of grey text — and the illustrated tiles the home
 * screen had just been given were nowhere on the one screen that is entirely
 * about categories.
 *
 * A grid of tiles, three across, using the SAME artwork family as home. The
 * trade heading is the way into the whole trade; each tile is the way into one
 * category. No card, no border — the heading and the white space do that work.
 *
 * Memoised and lifted out of the screen because this is the heaviest row in
 * the app (nine of these, up to fourteen tiles each) and an inline `renderItem`
 * rebuilds every one on any state change. That is the exact cause of the
 * scroll lag reported on the shop page.
 */
const TradeSection = React.memo(function TradeSectionBody({
  trade,
  styles,
  c,
  ground,
  onOpenTrade,
  onOpenCategory,
}: {
  trade: CategoryTrade;
  styles: ReturnType<typeof makeStyles>;
  c: ThemeColors;
  ground: (art: ReturnType<typeof tradeArt>) => string;
  onOpenTrade: (t: CategoryTrade) => void;
  onOpenCategory: (t: CategoryTrade, value: string, label: string) => void;
}) {
  const art = tradeArt(trade.type);
  const open = trade.shops_count > 0;

  return (
    <View style={styles.section}>
      <Touchable
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={
          open
            ? `${trade.label}, ${trade.shops_count} ${trade.shops_count === 1 ? "shop" : "shops"}`
            : `${trade.label}, no shops yet`
        }
        // A trade nobody has joined is a heading that says so, not a heading
        // that opens an empty list.
        onPress={open ? () => onOpenTrade(trade) : undefined}
        disabled={!open}
      >
        <View style={[styles.headIcon, { backgroundColor: ground(art) }]}>
          <art.Art size={22} />
        </View>
        <View style={styles.headCopy}>
          <Text style={[styles.headTitle, !open && styles.dim]} numberOfLines={1}>
            {trade.label}
          </Text>
          {/*
            The count in words. "1 shops" is the kind of detail that makes an
            app feel unfinished for the sake of two characters.
          */}
          <Text style={styles.headMeta}>
            {open
              ? `${trade.shops_count} ${trade.shops_count === 1 ? "shop" : "shops"} · see all`
              : "Coming soon"}
          </Text>
        </View>
        {open && <ChevronRightIcon size={16} color={c.textMuted} />}
      </Touchable>

      {/*
        The categories, only under a trade that has shops.

        Under an empty trade every tile would read zero, so fourteen faded
        tiles would say nothing the "Coming soon" above them has not — and
        they would make a page of nine trades scroll like a page of ninety.
      */}
      {open && trade.categories.length > 0 && (
        <View style={styles.grid}>
          {trade.categories.map((cat) => {
            const has = cat.shops_count > 0;

            return (
              <Touchable
                key={cat.value}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityLabel={
                  has ? `${cat.label}, ${cat.shops_count} shops` : `${cat.label}, no shops yet`
                }
                onPress={has ? () => onOpenCategory(trade, cat.value, cat.label) : undefined}
                disabled={!has}
              >
                {/*
                  The trade's own artwork, tinted by the trade's own ground —
                  so a Garments tile and a Footwear tile are visibly two
                  members of Retail. Categories have no art of their own and
                  inventing fourteen more per trade would be a hundred
                  illustrations for a page that is read once.
                */}
                <View style={[styles.cellArt, { backgroundColor: ground(art) }, !has && styles.faded]}>
                  <art.Art size={26} />
                </View>
                <Text style={[styles.cellLabel, !has && styles.dim]} numberOfLines={2}>
                  {cat.label}
                </Text>
                {has && <Text style={styles.cellCount}>{cat.shops_count}</Text>}
              </Touchable>
            );
          })}
        </View>
      )}
    </View>
  );
});

/** Memo-free because it depends on nothing but the styles object itself. */
const listStyle = (styles: ReturnType<typeof makeStyles>) => [styles.list, styles.grow];

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { padding: spacing.md },
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

    notice: {
      backgroundColor: c.warmSoft,
      borderRadius: radius.lg,
      padding: 12,
      gap: 6,
      marginBottom: spacing.md,
    },
    noticeText: { ...typography.small, color: c.text },
    noticeAction: { ...typography.small, color: c.primary, fontWeight: "700" },

    /**
     * A SECTION, not a card.
     *
     * Nine bordered boxes down a page is nine frames competing with the
     * artwork inside them. A heading, a grid, and the gap between sections
     * separate them — which is how the home screen already does it.
     */
    section: { marginBottom: spacing.md },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
    headIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: c.brand[100],
      alignItems: "center",
      justifyContent: "center",
    },
    headCopy: { flex: 1, gap: 1 },
    headTitle: { ...typography.label, color: c.text, fontSize: 15 },
    headMeta: { ...typography.tiny, color: c.textMuted },
    dim: { color: c.textMuted },

    /** Three across, so a fourth category starts a second row under the first. */
    grid: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.xs },
    cell: { width: "33.33%", alignItems: "center", gap: 5, paddingVertical: spacing.sm },
    cellArt: {
      width: 58,
      height: 58,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    /**
     * A category with nothing in it: same tile, faded, no count, no press. It
     * reads as a label rather than a control — which is what it is — and the
     * platform's breadth is still on the page.
     */
    faded: { opacity: 0.35 },
    cellLabel: {
      ...typography.tiny,
      color: c.text,
      fontWeight: "600",
      textAlign: "center",
      paddingHorizontal: 2,
    },
    cellCount: { ...typography.tiny, color: c.textMuted, fontSize: 10 },

    skeletonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: 12,
      marginBottom: spacing.sm,
    },
    skeletonCopy: { flex: 1, gap: 6 },
  });
