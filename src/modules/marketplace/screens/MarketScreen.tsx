import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
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
import { sameTrade } from "../tradeIcon";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { ShopFactsRow } from "../components/ShopFactsRow";
import { RatingChip } from "../components/RatingChip";
import { shopInitial, useShopCover } from "../shopCover";
import { SmartImage } from "../../../common/ui/SmartImage";
import { OfferBadge, Price } from "../../../common/ui/Price";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useLocationStore } from "../../../stores/locationStore";
import { useHomeFeed, useMarketShops } from "../hooks/useMarketplace";
import type { PublicShop } from "../services/marketplaceService";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";

const typeLabel = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Shop");

/**
 * Shop-list screen — the Grocery tab AND every "See all"/category list.
 * Green hero header + deals strip + designed shop rows (nearest first).
 */
export function MarketScreen() {
  const c = useColors();
  const coverFor = useShopCover();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const businessType: string | undefined = route.params?.business_type;
  const title: string = route.params?.title ?? "Shops";
  const isTab = route.name === "GroceryTab" || route.name === "Market";
  const { lat, lng } = useLocationStore();

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);

  const shops = useMarketShops({
    search: debounced,
    business_type: businessType,
    lat: lat ?? undefined,
    lng: lng ?? undefined,
  });
  const pull = usePullToRefresh(shops.refetch);
  const rows = (shops.data?.pages ?? []).flatMap((p) => p.data);

  // Deals strip scoped to this list's business type (grocery tab → grocery deals).
  const feed = useHomeFeed({ lat: lat ?? undefined, lng: lng ?? undefined });
  const deals = (feed.data?.deals ?? []).filter(
    // `sameTrade`, not `===`. The tab passes `grocery` and every shop created
    // since the primary types replaced the narrow codes is stored as `mart` —
    // so an exact comparison emptied the strip on a tab full of them.
    (d) => !businessType || sameTrade(d.shop?.business_type, businessType),
  );

  // The bottom inset depends on WHERE THIS SCREEN IS.
  //
  // It is the Grocery tab and it is also `ShopList`, pushed from a home
  // shortcut. As a tab the floating bar covers the gesture area, so padding it
  // again opens a dead strip; pushed, nothing is below it and its last row
  // lands under the gesture bar. One component, two answers.
  return (
    <SafeScreen backgroundColor={c.brand[500]} edges={isTab ? ["top"] : ["top", "bottom"]}>
      <FocusedStatusBar style="light-content" background={c.brand[500]} />

      {/* ── Green hero header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {!isTab && (
            <Touchable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
              <ArrowLeftIcon size={19} color={c.white} />
            </Touchable>
          )}
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>Nearest to you first</Text>
          </View>
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

      {/* ── Body ──────────────────────────────────────────────────── */}
      <FlatList
        style={styles.body}
        data={rows}
        keyExtractor={(s) => s.slug}
        contentContainerStyle={[styles.list, styles.grow]}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.brand[500]} />
        }
        ListHeaderComponent={
          <>
            {/* Deals strip */}
            {deals.length > 0 && !debounced && (
              <>
                <Text style={styles.sectionTitle}>Deals near you</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dealRow}
                >
                  {deals.map((d) => (
                    <Touchable
                      key={d.id}
                      style={styles.dealCard}
                      onPress={() => d.shop && navigation.navigate("MarketShop", { slug: d.shop.slug })}
                    >
                      <View style={styles.dealImgWrap}>
                        <SmartImage
                          uri={d.image}
                          fallback={shopInitial(d.name)}
                          fallbackBackground={coverFor(d.id).bg}
                          fallbackColor={coverFor(d.id).fg}
                          style={styles.dealImg}
                        />
                        <OfferBadge
                          value={d.price}
                          was={d.original_price}
                          percent={d.percent_off}
                          style={styles.offBadge}
                        />
                      </View>
                      <View style={styles.dealBody}>
                        <Text style={styles.dealName} numberOfLines={1}>{d.name}</Text>
                        <Price value={d.price} was={d.original_price} size="md" tone="brand" />
                        <Text style={styles.dealShop} numberOfLines={1}>{d.shop?.business_name}</Text>
                      </View>
                    </Touchable>
                  ))}
                </ScrollView>
              </>
            )}
            <Text style={styles.sectionTitle}>
              {debounced ? `Results for "${debounced}"` : "All shops"}
            </Text>
          </>
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
    paddingBottom: spacing.md,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
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
