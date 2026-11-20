import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useIsFocused, useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeftIcon, SearchIcon, StorefrontIcon } from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { Appear } from "../../../common/ui/Appear";
import { Touchable } from "../../../common/ui/Touchable";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { ShopFilters } from "../components/ShopFilters";
import { ShopFilterSheet } from "../components/ShopFilterSheet";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useServingPin } from "../servingPin";
import { useTabBarSpace } from "../../../navigation/tabBarSpace";
import { useCategories, useMarketShops } from "../hooks/useMarketplace";
import { HomeHero } from "../components/HomeHero";
import { ShopTile } from "../components/ShopTile";
import { homeCategoryTiles, TILE_GAP, tileSize, type TileSize } from "../homeCategories";
import { categoryPicture, picture } from "../tradePicture";
import { ShopWithItems } from "../components/ShopWithItems";
import type { ShopQuery } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";

const NO_BANNERS: never[] = [];

/** Food is the Home tab's; the grocery tab shows every other kind of shop. */
const KITCHEN_TRADES = new Set(["food", "restaurant", "bakery"]);

/**
 * Shop-list screen — the Grocery tab AND every "See all"/category list.
 * Green hero header + deals strip + designed shop rows (nearest first).
 */
export function MarketScreen() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const across = React.useMemo(() => tileSize(width), [width]);
  const styles = React.useMemo(() => makeStyles(c, across), [c, across]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const businessType: string | undefined = route.params?.business_type;
  /**
   * The finer trade, when the shopper picked one — "Garments" rather than
   * "Retail Store". It arrives WITH `business_type`, not instead of it: the
   * deals strip below is scoped by trade, and a category alone would have left
   * a garments list showing pharmacy offers.
   */
  const businessCategory: string | undefined = route.params?.business_category;
  /** Opened from the paid row's "See all": today's featured shops only. */
  const featured = route.params?.featured === true;
  const title: string = route.params?.title ?? "Shops";
  const isTab = route.name === "GroceryTab" || route.name === "Market";
  const pin = useServingPin();
  const tabSpace = useTabBarSpace();

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);

  /**
   * WHAT THE SHOPPER NARROWED IT TO.
   *
   * Kept apart from the base query — the trade and the pin are what the SCREEN
   * decided, and a Reset must never clear those. Same split the aisle uses.
   */
  const [filters, setFilters] = useState<ShopQuery>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const shops = useMarketShops({
    ...filters,
    search: debounced,
    business_type: businessType,
    business_category: businessCategory,
    featured: featured || undefined,
    // Each card carries a strip of the shop's own items — the same card the
    // home list draws, so a shop looks the same on both screens.
    previews: true,
    // The pin AND the city — see `useServingPin`. This sent the pin only, so
    // the list was fenced by each shop's radius and by nothing else, and a
    // shopper in Karachi was shown shops from every other city.
    ...pin,
  });
  const pull = usePullToRefresh(shops.refetch);
  const rows = (shops.data?.pages ?? []).flatMap((p) => p.data);

  /*
   * ── THE GROCERY TAB IS A HOME OF ITS OWN ─────────────────────────────
   *
   * "Grocery screen still same hai, uska banner b wohi": it was a title, a
   * search box and a list. The reference's grocery tab is a second home — the
   * coloured hero with its banners, the kinds of shop that are not kitchens,
   * the popular shops as tiles, then the list. Only as the TAB: opened from a
   * category (`ShopList`) it stays the plain list that category asked for.
   * Everything here comes from caches Home already filled.
   */
  const focused = useIsFocused();
  /*
   * Its OWN slides, never Home's banners — "uska banner b wohi hai": the tab
   * showed the very kitchens Home had just shown. Each slide opens the shelf
   * it speaks for.
   */
  const slides = React.useMemo(
    () => [
      {
        id: "g-fresh",
        title: "Fresh groceries at your door",
        body: "Fruit, vegetables and daily needs from shops near you",
        cta: "Shop now",
        emoji: "🥦",
        art: picture("leafy_green"),
        onPress: () =>
          navigation.navigate("ShopList", {
            business_type: "mart",
            title: "Mart & Grocery",
          }),
      },
      {
        id: "g-dairy",
        title: "Milk, bread and eggs, every morning",
        body: "Order the daily basket from the shop down the road",
        cta: "Order now",
        emoji: "🥛",
        art: picture("glass_of_milk"),
        onPress: () =>
          navigation.navigate("ShopList", {
            business_type: "mart",
            business_category: "dairy_shop",
            title: "Dairy",
          }),
      },
      {
        id: "g-pharmacy",
        title: "Medicine from the pharmacy near you",
        body: "Order with care, pay when it arrives",
        cta: "Order now",
        emoji: "💊",
        art: picture("pill"),
        onPress: () =>
          navigation.navigate("ShopList", {
            business_type: "pharmacy",
            title: "Pharmacy & Medical",
          }),
      },
    ],
    [navigation],
  );
  const cats = useCategories({ city_id: pin.city_id }, { enabled: isTab });
  const shelfKinds = React.useMemo(
    () =>
      homeCategoryTiles(
        (cats.data?.business_types ?? []).filter((t) => !KITCHEN_TRADES.has(t.type)),
        10,
      ),
    [cats.data],
  );
  const popular = rows.slice(0, 8);

  // The bottom inset depends on WHERE THIS SCREEN IS.
  //
  // It is the Grocery tab and it is also `ShopList`, pushed from a home
  // shortcut. As a tab the floating bar covers the gesture area, so padding it
  // again opens a dead strip; pushed, nothing is below it and its last row
  // lands under the gesture bar. One component, two answers.
  return (
    <SafeScreen backgroundColor={isTab ? c.bg : c.brand[500]} edges={isTab ? [] : ["top", "bottom"]}>
      <FocusedStatusBar background={c.brand[500]} />

      {/* ── Brand hero header (the pushed list; the tab draws its hero in the list) ── */}
      {!isTab && (
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {!isTab && (
              <Touchable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
                <ArrowLeftIcon size={19} color={c.white} />
              </Touchable>
            )}
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {/*
              The ordering, on the same line as the title rather than under it.
              It is worth saying once — a list sorted by distance behaves
              differently from one sorted by name — and not worth its own row on
              a screen whose whole problem was rows.
            */}
            </View>
            <Text style={styles.subtitle}>Nearest first</Text>
          </View>
          <View style={styles.searchBar}>
            <SearchIcon size={18} color={c.gray[400]} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search shops…"
              placeholderTextColor={c.gray[400]}
              autoCapitalize="none"
              style={styles.searchInput}
            />
          </View>
        </View>
      )}

      {/*
        ── NARROWING A LIST OF SHOPS ──────────────────────────────

        Outside the list, not in its header: it stays put while the list
        scrolls, which is what a filter bar is for — and a header row inside a
        virtualised list is the shape that crashed the shop page twice today.
      */}
      {/*
        On the PAGE's ground, not the header's: a selected pill is filled in
        the brand colour, and on the brand-coloured header it disappeared into
        it — "active b backgorund k sth araha".
      */}
      {!isTab && (
        <View style={styles.filtersBand}>
          <ShopFilters value={filters} onChange={setFilters} onOpenAll={() => setSheetOpen(true)} />
        </View>
      )}

      {/* ── Body ──────────────────────────────────────────────────── */}
      <FlatList
        style={styles.body}
        data={rows}
        keyExtractor={(s) => s.slug}
        contentContainerStyle={[styles.list, styles.grow, { paddingBottom: tabSpace + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.brand[500]} />
        }
        /**
          ── WHAT USED TO BE HERE, AND WHY IT IS NOT ────────────────

          A horizontal strip of discounted PRODUCTS, and the heading "All
          shops" underneath it. Between the hero, the filter bar and those two,
          roughly 430px of a 640px phone went by before the first shop — so the
          screen you opened to see shops showed you one, under a rail of things
          that are not shops.

          The strip was also a second copy: the home screen carries "Deals for
          you" three taps earlier, from the same query. A list of shops answers
          "which shop", and the answer starts at the top of it now.

          The heading went with it for a simpler reason: it named the list it
          sat on, directly under a hero already carrying that name. Only the
          search result keeps a line, because "Results for X" says something the
          title does not.
        */
        ListHeaderComponent={
          isTab ? (
            <>
              <View style={styles.bleed}>
                <HomeHero
                  autoPlay={focused}
                  banners={NO_BANNERS}
                  onBanner={() => undefined}
                  ownSlides={slides}
                  header={
                    <View style={styles.tabHeader}>
                      <Text style={styles.title}>{title}</Text>
                      <View style={styles.searchBar}>
                        <SearchIcon size={18} color={c.gray[400]} />
                        <TextInput
                          value={search}
                          onChangeText={setSearch}
                          placeholder="Search shops…"
                          placeholderTextColor={c.gray[400]}
                          autoCapitalize="none"
                          style={styles.searchInput}
                        />
                      </View>
                    </View>
                  }
                />
              </View>
              {!debounced && shelfKinds.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.rail}
                  contentContainerStyle={styles.kinds}
                >
                  {shelfKinds.map((t) => (
                    <Touchable
                      key={t.key}
                      style={styles.kind}
                      accessibilityRole="button"
                      accessibilityLabel={t.label}
                      onPress={() =>
                        navigation.navigate("ShopList", {
                          business_type: t.trade,
                          business_category: t.value ?? undefined,
                          title: t.label,
                        })
                      }
                    >
                      <View style={styles.kindPic}>
                        <Image source={categoryPicture(t.value, t.label, t.trade)} style={styles.kindImg} />
                      </View>
                      <Text style={styles.kindLabel} numberOfLines={2}>
                        {t.label}
                      </Text>
                    </Touchable>
                  ))}
                </ScrollView>
              )}
              {!debounced && popular.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Popular shops</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.rail}
                    contentContainerStyle={styles.popular}
                  >
                    {popular.map((s) => (
                      <ShopTile
                        key={s.slug}
                        shop={s}
                        onPress={() => navigation.navigate("MarketShop", { slug: s.slug })}
                      />
                    ))}
                  </ScrollView>
                </>
              )}
              <View style={styles.tabFilters}>
                <ShopFilters value={filters} onChange={setFilters} onOpenAll={() => setSheetOpen(true)} />
              </View>
              <Text style={styles.sectionTitle}>{debounced ? `Results for “${debounced}”` : "All shops"}</Text>
            </>
          ) : debounced ? (
            <Text style={styles.sectionTitle}>Results for “{debounced}”</Text>
          ) : null
        }
        ListEmptyComponent={
          shops.isLoading ? (
            <View style={styles.skeletons}>
              {[0, 1, 2, 3].map((i) => (
                <SkeletonListRow key={i} />
              ))}
            </View>
          ) : shops.isError ? (
            <LoadFailed
              what="shops near you"
              error={shops.error}
              onRetry={() => shops.refetch()}
              retrying={shops.isFetching}
            />
          ) : (
            <EmptyState
              icon={StorefrontIcon}
              tone={debounced ? "muted" : "warm"}
              title={debounced ? `Nothing matches “${debounced}”` : "No shops here yet"}
              message={
                debounced
                  ? "Try a shorter word, or a different spelling."
                  : "New shops join every week. Widening your location will find more."
              }
            />
          )
        }
        // Half a screen ahead, and guarded against `onEndReached` firing more
        // than once while the list settles.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (shops.hasNextPage && !shops.isFetchingNextPage) shops.fetchNextPage({ cancelRefetch: false });
        }}
        ListFooterComponent={
          shops.isFetchingNextPage ? (
            <View style={styles.more}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Appear index={index}>
            <ShopWithItems
              shop={item}
              onOpen={() => navigation.navigate("MarketShop", { slug: item.slug })}
              onItem={(productId) =>
                navigation.navigate("MarketShop", {
                  slug: item.slug,
                  productId,
                })
              }
            />
          </Appear>
        )}
      />

      <ShopFilterSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} />
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors, ts: TileSize = tileSize(390)) =>
  StyleSheet.create({
    header: {
      backgroundColor: c.brand[500],
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.md,
    },
    filtersBand: { backgroundColor: c.bg, paddingTop: spacing.sm },
    headerTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    back: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerText: { flex: 1 },
    title: { ...typography.title, color: c.white },
    subtitle: { ...typography.tiny, color: c.brand[100] },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: 22,
      paddingHorizontal: spacing.md,
      height: 46,
    },
    searchInput: { flex: 1, ...typography.body, color: c.text, padding: 0 },

    body: { flex: 1, backgroundColor: c.bg },
    list: { padding: spacing.md, paddingBottom: spacing.xxl },
    // The tab's own header rides the hero: the title and the search box.
    // The hero runs edge to edge, out of the list's own padding.
    bleed: { marginHorizontal: -spacing.md, marginTop: -spacing.md },
    tabHeader: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    // A rail scrolls to the screen's edge, not to the list's padding.
    rail: { marginHorizontal: -spacing.md },
    kinds: {
      paddingHorizontal: spacing.md,
      gap: TILE_GAP,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    kind: { width: ts.tile, alignItems: "center", gap: 6 },
    kindPic: {
      width: ts.tile,
      height: ts.tile,
      borderRadius: ts.radius,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    kindImg: { width: ts.pic, height: ts.pic },
    kindLabel: {
      ...typography.caption,
      color: c.text,
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
    },
    popular: {
      paddingHorizontal: spacing.md,
      gap: spacing.ms,
      paddingBottom: spacing.sm,
    },
    tabFilters: { marginHorizontal: -spacing.md, marginTop: spacing.sm },
    /** So `ListEmptyComponent` has a screen to centre in. */
    grow: { flexGrow: 1 },
    // The same section rhythm as Home (24 above, 12 below) — the category
    // labels sat 8 above "Popular shops", which read as one block.
    sectionTitle: {
      ...typography.h3,
      color: c.text,
      fontSize: 18,
      lineHeight: 24,
      marginBottom: spacing.ms,
      marginTop: spacing.lg,
    },

    dealRow: { gap: spacing.sm, paddingBottom: spacing.md },
    dealCard: {
      width: 158,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    dealImgWrap: {
      height: 96,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    dealImg: { width: "100%", height: "100%" },
    dealInitial: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "700",
      color: c.gray[200],
    },
    // Position only — `OfferBadge` owns its own fill, and that fill is amber.
    offBadge: { position: "absolute", left: 8, top: 8 },
    dealBody: {
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 10,
      gap: 3,
    },
    dealName: {
      ...typography.label,
      color: c.text,
      fontSize: 14,
      lineHeight: 18,
    },
    dealShop: {
      ...typography.tiny,
      color: c.gray[500],
      fontSize: 11,
      lineHeight: 14,
    },

    more: { paddingVertical: spacing.lg, alignItems: "center" },
    skeletons: { gap: spacing.sm },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    rowClosed: { opacity: 0.55 },
    logo: {
      width: 60,
      height: 60,
      borderRadius: radius.md,
      backgroundColor: c.brand[50],
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: { ...typography.display, fontSize: 22, lineHeight: 28 },
    rowInfo: { flex: 1, gap: 2 },
    rowNameLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowName: {
      flexShrink: 1,
      ...typography.label,
      color: c.text,
      fontSize: 16,
      lineHeight: 22,
    },
    rowMeta: { ...typography.tiny, color: c.gray[500] },
  });
