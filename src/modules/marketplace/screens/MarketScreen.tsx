import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  StorefrontIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { Appear } from "../../../common/ui/Appear";
import { Touchable } from "../../../common/ui/Touchable";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { ShopFilters } from "../components/ShopFilters";
import { ShopFilterSheet } from "../components/ShopFilterSheet";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { ShopFactsRow } from "../components/ShopFactsRow";
import { RatingChip } from "../components/RatingChip";
import { shopInitial, useShopCover } from "../shopCover";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useServingPin } from "../servingPin";
import { useMarketShops } from "../hooks/useMarketplace";
import type { PublicShop, ShopQuery } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";

const typeLabel = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Shop");

/**
 * Shop-list screen — the Grocery tab AND every "See all"/category list.
 * Green hero header + deals strip + designed shop rows (nearest first).
 */
export function MarketScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
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
  const title: string = route.params?.title ?? "Shops";
  const isTab = route.name === "GroceryTab" || route.name === "Market";
  const pin = useServingPin();

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
    // The pin AND the city — see `useServingPin`. This sent the pin only, so
    // the list was fenced by each shop's radius and by nothing else, and a
    // shopper in Karachi was shown shops from every other city.
    ...pin,
  });
  const pull = usePullToRefresh(shops.refetch);
  const rows = (shops.data?.pages ?? []).flatMap((p) => p.data);

  // The bottom inset depends on WHERE THIS SCREEN IS.
  //
  // It is the Grocery tab and it is also `ShopList`, pushed from a home
  // shortcut. As a tab the floating bar covers the gesture area, so padding it
  // again opens a dead strip; pushed, nothing is below it and its last row
  // lands under the gesture bar. One component, two answers.
  return (
    <SafeScreen backgroundColor={c.brand[500]} edges={isTab ? ["top"] : ["top", "bottom"]}>
      <FocusedStatusBar style="light-content" background={c.brand[500]} />

      {/* ── Brand hero header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {!isTab && (
            <Touchable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
              <ArrowLeftIcon size={19} color={c.white} />
            </Touchable>
          )}
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
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

      {/*
        ── NARROWING A LIST OF SHOPS ──────────────────────────────

        Outside the list, not in its header: it stays put while the list
        scrolls, which is what a filter bar is for — and a header row inside a
        virtualised list is the shape that crashed the shop page twice today.
      */}
      <ShopFilters value={filters} onChange={setFilters} onOpenAll={() => setSheetOpen(true)} />

      {/* ── Body ──────────────────────────────────────────────────── */}
      <FlatList
        style={styles.body}
        data={rows}
        keyExtractor={(s) => s.slug}
        contentContainerStyle={[styles.list, styles.grow]}
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
          debounced ? <Text style={styles.sectionTitle}>Results for “{debounced}”</Text> : null
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
          if (shops.hasNextPage && !shops.isFetchingNextPage) shops.fetchNextPage();
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
            <ShopRow shop={item} onPress={() => navigation.navigate("MarketShop", { slug: item.slug })} />
          </Appear>
        )}
      />

      <ShopFilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        value={filters}
        onApply={setFilters}
      />
    </SafeScreen>
  );
}

function ShopRow({ shop, onPress }: { shop: PublicShop; onPress: () => void }) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const closed = shop.is_open_now === false;
  const coverFor = useShopCover();
  const cover = coverFor(shop.slug);
  return (
    <Touchable style={[styles.row, closed && styles.rowClosed]} onPress={onPress}>
      {/* The same derived cover as the home row — a shop looks the same
          wherever it appears. See `shopCover.ts`. */}
      <View style={[styles.logo, { backgroundColor: cover.bg }]}>
        <Text style={[styles.logoText, { color: cover.fg }]}>
          {shopInitial(shop.business_name)}
        </Text>
      </View>
      <View style={styles.rowInfo}>
        <View style={styles.rowNameLine}>
          <Text style={styles.rowName} numberOfLines={1}>{shop.business_name}</Text>
          <RatingChip rating={shop.rating} />
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {typeLabel(shop.business_type)}
          {shop.city ? ` · ${shop.city.name}` : ""}
        </Text>
        <ShopFactsRow shop={shop} closed={closed} />
      </View>
      <ChevronRightIcon size={18} color={c.gray[300]} />
    </Touchable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  header: {
    backgroundColor: c.brand[500],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    // Was `spacing.md`. Every pixel here is a pixel the first shop row is
    // pushed down by, and the search bar below already carries its own height.
    paddingBottom: spacing.sm,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
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
  /** So `ListEmptyComponent` has a screen to centre in. */
  grow: { flexGrow: 1 },
  sectionTitle: { ...typography.h3, color: c.text, fontSize: 17, marginBottom: spacing.sm, marginTop: spacing.xs },

  dealRow: { gap: spacing.sm, paddingBottom: spacing.md },
  dealCard: {
    width: 158,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  dealImgWrap: { height: 96, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" },
  dealImg: { width: "100%", height: "100%" },
  dealInitial: { fontSize: 30, fontWeight: "700", color: c.gray[200] },
  // Position only — `OfferBadge` owns its own fill, and that fill is amber.
  offBadge: { position: "absolute", left: 8, top: 8 },
  dealBody: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 3 },
  dealName: { ...typography.label, color: c.text, fontSize: 13.5 },
  dealShop: { ...typography.tiny, color: c.gray[500], fontSize: 10 },

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
  logoText: { ...typography.display, fontSize: 24 },
  rowInfo: { flex: 1, gap: 2 },
  rowNameLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowName: { flexShrink: 1, ...typography.label, color: c.text, fontSize: 15.5 },
  rowMeta: { ...typography.tiny, color: c.gray[500] },
});
