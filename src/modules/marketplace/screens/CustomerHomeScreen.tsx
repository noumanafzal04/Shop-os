import React, { useEffect } from "react";
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Bell, ChevronDown, MapPin, Search, Star } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { FocusedStatusBar } from "../../../common/ui/FocusedStatusBar";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useAuthStore } from "../../../stores/authStore";
import { useLocationStore } from "../../../stores/locationStore";
import { useHomeFeed } from "../hooks/useMarketplace";
import { marketplaceService, type HomeBanner, type PublicShop } from "../services/marketplaceService";

/** Business-type chip icons — emoji keeps it asset-free and crisp. */
const TYPE_ICONS: Record<string, string> = {
  restaurant: "🍕",
  grocery: "🛒",
  pharmacy: "💊",
  retail: "🛍️",
  salon: "💇",
  workshop: "🔧",
  service: "🧰",
  wholesale: "📦",
  books: "📚",
  hardware: "🛠️",
};

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function CustomerHomeScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const { status, lat, lng, label, detect } = useLocationStore();

  // First launch: resolve GPS → city automatically (foodpanda-style).
  useEffect(() => {
    if (status === "idle") detect();
  }, [status, detect]);

  const feed = useHomeFeed({ lat: lat ?? undefined, lng: lng ?? undefined });
  const firstName = user?.name?.split(" ")[0];

  const onBanner = async (b: HomeBanner) => {
    marketplaceService.bannerClick(b.id).catch(() => {});
    if (b.target.type === "shop" && b.target.shop_slug) {
      navigation.navigate("MarketShop", { slug: b.target.shop_slug });
    }
  };

  const openShop = (shop: PublicShop) => navigation.navigate("MarketShop", { slug: shop.slug });

  return (
    <SafeScreen backgroundColor={colors.brand[500]} edges={["top"]}>
      <FocusedStatusBar style="light-content" background={colors.brand[500]} />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => feed.refetch()} tintColor={colors.brand[500]} />
        }
      >
        {/* ── Green hero header ─────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.hello}>
              <Text style={styles.welcome}>Welcome{firstName ? "," : ""}</Text>
              <Text style={styles.name}>{firstName ?? "Guest"}</Text>
            </View>
            <Pressable style={styles.bell} onPress={() => navigation.navigate("Notifications")}>
              <Bell size={20} color={colors.white} strokeWidth={2} />
            </Pressable>
          </View>

          {/* Location row — tap to change the delivery address */}
          <Pressable style={styles.locationRow} onPress={() => navigation.navigate("Location")}>
            <MapPin size={14} color={colors.white} strokeWidth={2.2} />
            <Text style={styles.locationText} numberOfLines={1}>
              {status === "locating" ? "Finding you…" : label ?? "Set your location"}
            </Text>
            <ChevronDown size={14} color={colors.brand[100]} strokeWidth={2.2} />
          </Pressable>

          {/* Search — opens the universal search screen */}
          <Pressable style={styles.searchBar} onPress={() => navigation.navigate("Search")}>
            <Search size={18} color={colors.gray[400]} strokeWidth={2} />
            <Text style={styles.searchHint}>Search food, groceries, medicine…</Text>
          </Pressable>
        </View>

        {/* ── Light content area ────────────────────────────────── */}
        <View style={styles.body}>
          {/* Quick actions (foodpanda-style tiles) */}
          <View style={styles.quickRow}>
            {(
              [
                ["🏷️", "Offers", () => navigation.navigate("ShopList", { title: "Shops with offers" })],
                ["🛍️", "Pick-up", () => navigation.navigate("ShopList", { title: "Pick-up" })],
                ["✨", "New shops", () => navigation.navigate("ShopList", { title: "New shops" })],
                ["⭐", "Top rated", () => navigation.navigate("ShopList", { title: "Top rated" })],
              ] as Array<[string, string, () => void]>
            ).map(([emoji, label, go]) => (
              <Pressable key={label} style={styles.quick} onPress={go}>
                <View style={styles.quickIcon}>
                  <Text style={styles.quickEmoji}>{emoji}</Text>
                </View>
                <Text style={styles.quickLabel}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Business-type chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.chipsScroll}
          >
            {(feed.data?.business_types ?? []).map((t) => (
              <Pressable
                key={t.type}
                style={styles.chip}
                onPress={() => navigation.navigate("ShopList", { business_type: t.type, title: typeLabel(t.type) })}
              >
                <View style={styles.chipIcon}>
                  <Text style={styles.chipEmoji}>{TYPE_ICONS[t.type] ?? "🏬"}</Text>
                </View>
                <Text style={styles.chipLabel}>{typeLabel(t.type)}</Text>
              </Pressable>
            ))}
            {feed.isLoading &&
              [0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.chip}>
                  <Skeleton width={56} height={56} borderRadius={radius.full} />
                  <Skeleton width={44} height={10} borderRadius={4} />
                </View>
              ))}
          </ScrollView>

          {/* Out-of-service notice */}
          {status === "unserved" && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                We're not in your area yet — showing everything instead.
              </Text>
            </View>
          )}

          {/* Promo banners */}
          {(feed.data?.banners.length ?? 0) > 0 && (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={feed.data!.banners}
              keyExtractor={(b) => b.id}
              contentContainerStyle={styles.bannerRow}
              renderItem={({ item }) => (
                <Pressable style={styles.banner} onPress={() => onBanner(item)}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.bannerImg} resizeMode="cover" />
                  ) : (
                    <View style={[styles.bannerImg, styles.bannerFallback]}>
                      <Text style={styles.bannerTitleAlt}>{item.title}</Text>
                    </View>
                  )}
                </Pressable>
              )}
            />
          )}

          {/* Near you */}
          <SectionHeader
            title="Near you"
            onSeeAll={() => navigation.navigate("ShopList", { title: "Near you" })}
          />
          {feed.isLoading ? (
            <View style={styles.hRow}>
              {[0, 1].map((i) => (
                <Skeleton key={i} width={220} height={120} borderRadius={radius.lg} />
              ))}
            </View>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={feed.data?.nearby ?? []}
              keyExtractor={(s) => s.slug}
              contentContainerStyle={styles.hRow}
              ListEmptyComponent={<Text style={styles.empty}>No shops around here yet.</Text>}
              renderItem={({ item }) => <ShopCard shop={item} onPress={() => openShop(item)} />}
            />
          )}

          {/* Deals — % off product carousel (like "Dishes up to 35% off") */}
          {(feed.data?.deals.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Deals for you" />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={feed.data!.deals}
                keyExtractor={(d) => d.id}
                contentContainerStyle={styles.hRow}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.dealCard}
                    onPress={() => item.shop && navigation.navigate("MarketShop", { slug: item.shop.slug })}
                  >
                    <View style={styles.dealImgWrap}>
                      {item.image ? (
                        <Image source={{ uri: item.image }} style={styles.dealImg} resizeMode="cover" />
                      ) : (
                        <Text style={styles.dealInitial}>{item.name.charAt(0)}</Text>
                      )}
                      <View style={styles.offBadge}>
                        <Text style={styles.offBadgeText}>{item.percent_off}% off</Text>
                      </View>
                    </View>
                    <View style={styles.dealBody}>
                      <Text style={styles.dealName} numberOfLines={1}>{item.name}</Text>
                      <View style={styles.dealPriceRow}>
                        <Text style={styles.dealPrice}>Rs {item.price.toLocaleString()}</Text>
                        <Text style={styles.dealStrike}>Rs {item.original_price.toLocaleString()}</Text>
                      </View>
                      <Text style={styles.dealShop} numberOfLines={1}>
                        {item.shop?.business_name}
                        {item.distance_km != null ? ` · ${item.distance_km} km` : ""}
                      </Text>
                    </View>
                  </Pressable>
                )}
              />
            </>
          )}

          {/* Top rated */}
          {(feed.data?.top_rated.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Top rated" />
              <View style={styles.grid}>
                {feed.data!.top_rated.map((s) => (
                  <ShopCard key={s.slug} shop={s} wide onPress={() => openShop(s)} />
                ))}
              </View>
            </>
          )}

          {/* Explore shops — the long vertical tail of the page */}
          {(feed.data?.nearby.length ?? 0) > 0 && (
            <>
              <SectionHeader
                title="Explore shops"
                onSeeAll={() => navigation.navigate("ShopList", { title: "All shops" })}
              />
              <View style={styles.grid}>
                {feed.data!.nearby.map((s) => (
                  <ShopCard key={`x-${s.slug}`} shop={s} wide onPress={() => openShop(s)} />
                ))}
              </View>
            </>
          )}

          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      )}
    </View>
  );
}

function ShopCard({ shop, wide = false, onPress }: { shop: PublicShop; wide?: boolean; onPress: () => void }) {
  const closed = shop.is_open_now === false;
  return (
    <Pressable style={[styles.shopCard, wide && styles.shopCardWide, closed && styles.shopClosed]} onPress={onPress}>
      <View style={styles.shopLogo}>
        <Text style={styles.shopInitial}>{shop.business_name.charAt(0)}</Text>
      </View>
      <View style={styles.shopInfo}>
        <Text style={styles.shopName} numberOfLines={1}>{shop.business_name}</Text>
        <Text style={styles.shopMeta} numberOfLines={1}>
          {typeLabel(shop.business_type ?? "shop")}
          {shop.city ? ` · ${shop.city.name}` : ""}
        </Text>
        <View style={styles.shopStats}>
          {shop.rating !== null && (
            <View style={styles.stat}>
              <Star size={12} color="#f5a623" fill="#f5a623" strokeWidth={0} />
              <Text style={styles.statText}>{shop.rating}</Text>
            </View>
          )}
          {shop.distance_km != null && (
            <Text style={styles.statText}>{shop.distance_km} km</Text>
          )}
          {closed && <Text style={styles.closedText}>Closed</Text>}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.brand[500] },

  // Header
  header: {
    backgroundColor: colors.brand[500],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  hello: { gap: 2 },
  welcome: { ...typography.small, color: colors.brand[100] },
  name: { ...typography.title, color: colors.white },
  bell: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm },
  locationText: { ...typography.small, color: colors.white, fontWeight: "600", maxWidth: 240 },
  searchBar: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchHint: { ...typography.body, color: colors.gray[400] },

  // Body
  body: { backgroundColor: colors.bg, minHeight: 600 },
  quickRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  quick: { alignItems: "center", gap: 6, width: 70 },
  quickIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  quickEmoji: { fontSize: 26 },
  quickLabel: { ...typography.tiny, color: colors.gray[600], fontWeight: "600" },
  chipsScroll: { marginTop: spacing.md },
  chips: { paddingHorizontal: spacing.md, gap: spacing.md },
  chip: { alignItems: "center", gap: 6, width: 64 },
  chipIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipEmoji: { fontSize: 24 },
  chipLabel: { ...typography.tiny, color: colors.gray[600] },

  notice: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { ...typography.small, color: colors.warning },

  bannerRow: { paddingHorizontal: spacing.md, gap: spacing.sm, marginTop: spacing.lg },
  banner: { borderRadius: radius.lg, overflow: "hidden" },
  bannerImg: { width: 300, height: 130, borderRadius: radius.lg },
  bannerFallback: { backgroundColor: colors.cream, alignItems: "center", justifyContent: "center", padding: spacing.md },
  bannerTitleAlt: { ...typography.h3, color: colors.black, textAlign: "center" },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.h3, color: colors.black, fontSize: 18 },
  seeAll: { ...typography.label, color: colors.brand[600] },

  hRow: { paddingHorizontal: spacing.md, gap: spacing.sm },
  grid: { paddingHorizontal: spacing.md, gap: spacing.sm },
  empty: { ...typography.small, color: colors.gray[400], paddingVertical: spacing.md },

  shopCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    width: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  shopCardWide: { width: "100%" },
  shopClosed: { opacity: 0.55 },
  shopLogo: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  shopInitial: { ...typography.title, color: colors.brand[600] },
  shopInfo: { flex: 1, gap: 2 },
  shopName: { ...typography.label, color: colors.black, fontSize: 15 },
  shopMeta: { ...typography.tiny, color: colors.gray[500] },
  shopStats: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stat: { flexDirection: "row", alignItems: "center", gap: 3 },
  statText: { ...typography.tiny, color: colors.gray[600] },
  closedText: { ...typography.tiny, color: colors.error, fontWeight: "700" },

  // Deals carousel
  dealCard: {
    width: 168,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  dealImgWrap: {
    height: 108,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  dealImg: { width: "100%", height: "100%" },
  dealInitial: { fontSize: 34, fontWeight: "700", color: colors.gray[200] },
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
  dealName: { ...typography.label, color: colors.black, fontSize: 14 },
  dealPriceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dealPrice: { ...typography.label, color: colors.brand[600], fontSize: 14 },
  dealStrike: { ...typography.tiny, color: colors.gray[400], textDecorationLine: "line-through" },
  dealShop: { ...typography.tiny, color: colors.gray[500] },
});
