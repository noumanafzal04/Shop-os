import React, { useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, ChevronRight, Search, Star } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useLocationStore } from "../../../stores/locationStore";
import { useHomeFeed, useMarketShops } from "../hooks/useMarketplace";
import type { PublicShop } from "../services/marketplaceService";

const typeLabel = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Shop");

/**
 * Shop-list screen — the Grocery tab AND every "See all"/category list.
 * Green hero header + deals strip + designed shop rows (nearest first).
 */
export function MarketScreen() {
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
  const rows = shops.data?.data ?? [];

  // Deals strip scoped to this list's business type (grocery tab → grocery deals).
  const feed = useHomeFeed({ lat: lat ?? undefined, lng: lng ?? undefined });
  const deals = (feed.data?.deals ?? []).filter(
    (d) => !businessType || d.shop?.business_type === businessType,
  );

  return (
    <SafeScreen backgroundColor={colors.brand[500]} edges={["top"]}>
      <FocusedStatusBar style="light-content" background={colors.brand[500]} />

      {/* ── Green hero header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {!isTab && (
            <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
              <ArrowLeft size={19} color={colors.white} strokeWidth={2.2} />
            </Pressable>
          )}
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>Nearest to you first</Text>
          </View>
        </View>
        <View style={styles.searchBar}>
          <Search size={18} color={colors.gray[400]} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search shops…"
            placeholderTextColor={colors.gray[400]}
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
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={shops.isRefetching} onRefresh={() => shops.refetch()} tintColor={colors.brand[500]} />
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
                    <Pressable
                      key={d.id}
                      style={styles.dealCard}
                      onPress={() => d.shop && navigation.navigate("MarketShop", { slug: d.shop.slug })}
                    >
                      <View style={styles.dealImgWrap}>
                        {d.image ? (
                          <Image source={{ uri: d.image }} style={styles.dealImg} resizeMode="cover" />
                        ) : (
                          <Text style={styles.dealInitial}>{d.name.charAt(0)}</Text>
                        )}
                        <View style={styles.offBadge}>
                          <Text style={styles.offBadgeText}>{d.percent_off}% off</Text>
                        </View>
                      </View>
                      <View style={styles.dealBody}>
                        <Text style={styles.dealName} numberOfLines={1}>{d.name}</Text>
                        <View style={styles.dealPriceRow}>
                          <Text style={styles.dealPrice}>Rs {d.price.toLocaleString()}</Text>
                          <Text style={styles.dealStrike}>Rs {d.original_price.toLocaleString()}</Text>
                        </View>
                        <Text style={styles.dealShop} numberOfLines={1}>{d.shop?.business_name}</Text>
                      </View>
                    </Pressable>
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
                <Skeleton key={i} width="100%" height={86} borderRadius={radius.lg} />
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No shops found</Text>
              <Text style={styles.emptyText}>
                {debounced ? "Try a different search." : "Check back soon — new shops join every week."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <ShopRow shop={item} onPress={() => navigation.navigate("MarketShop", { slug: item.slug })} />}
      />
    </SafeScreen>
  );
}

function ShopRow({ shop, onPress }: { shop: PublicShop; onPress: () => void }) {
  const closed = shop.is_open_now === false;
  return (
    <Pressable style={[styles.row, closed && styles.rowClosed]} onPress={onPress}>
      <View style={styles.logo}>
        <Text style={styles.logoText}>{shop.business_name.charAt(0)}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>{shop.business_name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {typeLabel(shop.business_type)}
          {shop.city ? ` · ${shop.city.name}` : ""}
        </Text>
        <View style={styles.rowStats}>
          {shop.rating !== null && (
            <View style={styles.stat}>
              <Star size={12} color="#f5a623" fill="#f5a623" strokeWidth={0} />
              <Text style={styles.statText}>{shop.rating}</Text>
            </View>
          )}
          {shop.distance_km != null && <Text style={styles.statText}>{shop.distance_km} km</Text>}
          {closed ? (
            <Text style={styles.closedText}>Closed</Text>
          ) : (
            <Text style={styles.openText}>Open</Text>
          )}
        </View>
      </View>
      <ChevronRight size={18} color={colors.gray[300]} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.brand[500],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  back: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  title: { ...typography.title, color: colors.white },
  subtitle: { ...typography.tiny, color: colors.brand[100] },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.black, padding: 0 },

  body: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.h3, color: colors.black, fontSize: 17, marginBottom: spacing.sm, marginTop: spacing.xs },

  dealRow: { gap: spacing.sm, paddingBottom: spacing.md },
  dealCard: {
    width: 158,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  dealImgWrap: { height: 96, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  dealImg: { width: "100%", height: "100%" },
  dealInitial: { fontSize: 30, fontWeight: "700", color: colors.gray[200] },
  offBadge: {
    position: "absolute",
    left: 8,
    top: 8,
    backgroundColor: colors.brand[500],
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offBadgeText: { ...typography.tiny, color: colors.white, fontWeight: "700", fontSize: 10 },
  dealBody: { padding: spacing.sm, gap: 2 },
  dealName: { ...typography.label, color: colors.black, fontSize: 13 },
  dealPriceRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dealPrice: { ...typography.label, color: colors.brand[600], fontSize: 13 },
  dealStrike: { ...typography.tiny, color: colors.gray[400], textDecorationLine: "line-through", fontSize: 10 },
  dealShop: { ...typography.tiny, color: colors.gray[500], fontSize: 10 },

  skeletons: { gap: spacing.sm },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: 4 },
  emptyTitle: { ...typography.h3, color: colors.black },
  emptyText: { ...typography.small, color: colors.gray[500], textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  rowClosed: { opacity: 0.55 },
  logo: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { ...typography.title, color: colors.brand[600] },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...typography.label, color: colors.black, fontSize: 15.5 },
  rowMeta: { ...typography.tiny, color: colors.gray[500] },
  rowStats: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 1 },
  stat: { flexDirection: "row", alignItems: "center", gap: 3 },
  statText: { ...typography.tiny, color: colors.gray[600] },
  openText: { ...typography.tiny, color: colors.brand[600], fontWeight: "700" },
  closedText: { ...typography.tiny, color: colors.error, fontWeight: "700" },
});
