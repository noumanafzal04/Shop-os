import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Search, Star, Store } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Skeleton } from "../../../common/ui/Skeleton";
import { colors, radius, spacing, typography } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useLocationStore } from "../../../stores/locationStore";
import { useUniversalSearch } from "../hooks/useMarketplace";

const money = (n: number) => `Rs ${n.toLocaleString()}`;

type Tab = "all" | "products" | "shops";

/**
 * Universal search, reference layout: one box → result TABS
 * (All | Products | Shops) + filter chips (Open now, 4★+).
 */
export function SearchScreen() {
  const navigation = useNavigation<any>();
  const { lat, lng } = useLocationStore();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const debounced = useDebouncedValue(q, 250);

  const results = useUniversalSearch(debounced, { lat: lat ?? undefined, lng: lng ?? undefined });
  const d = results.data;
  const searching = debounced.trim().length >= 2;

  let shops = d?.shops ?? [];
  if (openOnly) shops = shops.filter((s) => s.is_open_now !== false);
  if (topOnly) shops = shops.filter((s) => (s.rating ?? 0) >= 4);
  const products = d?.products ?? [];
  const categories = d?.categories ?? [];
  const total = products.length + shops.length;

  const showProducts = tab !== "shops";
  const showShops = tab !== "products";

  return (
    <SafeScreen backgroundColor={colors.bg} edges={["top"]}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={colors.black} strokeWidth={2} />
        </Pressable>
        <View style={styles.searchInput}>
          <AppTextInput
            icon={Search}
            placeholder="Search food, groceries, medicine…"
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCapitalize="none"
          />
        </View>
      </View>

      {/* Result tabs */}
      {searching && (
        <>
          <View style={styles.tabs}>
            {(
              [
                ["all", "All"],
                ["products", "Products"],
                ["shops", "Shops"],
              ] as Array<[Tab, string]>
            ).map(([key, label]) => (
              <Pressable key={key} style={styles.tabBtn} onPress={() => setTab(key)}>
                <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
                {tab === key && <View style={styles.tabLine} />}
              </Pressable>
            ))}
          </View>

          {/* Filter chips (shops) */}
          {showShops && (
            <View style={styles.filters}>
              <FilterChip label="Open now" on={openOnly} onPress={() => setOpenOnly((v) => !v)} />
              <FilterChip label="4★ & up" on={topOnly} onPress={() => setTopOnly((v) => !v)} />
            </View>
          )}
        </>
      )}

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!searching ? (
          <View style={styles.hintWrap}>
            <Text style={styles.hint}>Type at least 2 letters — we search products, shops and categories at once.</Text>
          </View>
        ) : results.isLoading ? (
          <View style={styles.section}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} width="100%" height={64} borderRadius={radius.lg} />
            ))}
          </View>
        ) : (
          <>
            {searching && !results.isLoading && (
              <Text style={styles.resultCount}>
                {total} result{total === 1 ? "" : "s"} for "{debounced}"
              </Text>
            )}

            {/* Products */}
            {showProducts && products.length > 0 && (
              <View style={styles.section}>
                {tab === "all" && <Text style={styles.sectionTitle}>Products</Text>}
                {products.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.row}
                    onPress={() => p.shop && navigation.navigate("MarketShop", { slug: p.shop.slug })}
                  >
                    <View style={styles.thumb}>
                      {p.image ? (
                        <Image source={{ uri: p.image }} style={styles.thumbImg} />
                      ) : (
                        <Text style={styles.thumbInitial}>{p.name.charAt(0)}</Text>
                      )}
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {p.shop?.business_name}
                        {p.distance_km != null ? ` · ${p.distance_km} km` : ""}
                      </Text>
                    </View>
                    <View style={styles.priceWrap}>
                      <Text style={styles.price}>{money(p.price)}</Text>
                      {p.original_price != null && <Text style={styles.strike}>{money(p.original_price)}</Text>}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Shops */}
            {showShops && shops.length > 0 && (
              <View style={styles.section}>
                {tab === "all" && <Text style={styles.sectionTitle}>Shops</Text>}
                {shops.map((s) => (
                  <Pressable
                    key={s.slug}
                    style={styles.row}
                    onPress={() => navigation.navigate("MarketShop", { slug: s.slug })}
                  >
                    <View style={[styles.thumb, styles.shopThumb]}>
                      <Store size={20} color={colors.brand[600]} strokeWidth={2} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{s.business_name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {s.business_type}
                        {s.distance_km != null ? ` · ${s.distance_km} km` : ""}
                        {s.is_open_now === false ? " · Closed" : ""}
                      </Text>
                    </View>
                    {s.rating !== null && (
                      <View style={styles.rating}>
                        <Star size={12} color="#f5a623" fill="#f5a623" strokeWidth={0} />
                        <Text style={styles.ratingText}>{s.rating}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {/* Categories (All tab only) */}
            {tab === "all" && categories.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Categories</Text>
                <View style={styles.catWrap}>
                  {categories.map((c) => (
                    <Pressable key={c.name} style={styles.catChip} onPress={() => setQ(c.name)}>
                      <Text style={styles.catText}>{c.name}</Text>
                      <Text style={styles.catCount}>{c.shops_count}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {d && total === 0 && (
              <View style={styles.hintWrap}>
                <Text style={styles.hint}>Nothing matches "{debounced}" — try another word.</Text>
              </View>
            )}
          </>
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeScreen>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.filter, on && styles.filterOn]} onPress={onPress}>
      <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: { flex: 1 },

  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  tabBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  tabText: { ...typography.label, color: colors.gray[400], fontSize: 14 },
  tabTextOn: { color: colors.brand[700] },
  tabLine: {
    position: "absolute",
    bottom: -1,
    left: spacing.sm,
    right: spacing.sm,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.brand[500],
  },

  filters: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterOn: { backgroundColor: colors.brand[500], borderColor: colors.brand[500] },
  filterText: { ...typography.tiny, color: colors.gray[600], fontWeight: "600" },
  filterTextOn: { color: colors.white },

  resultCount: { ...typography.h3, color: colors.black, fontSize: 16, paddingHorizontal: spacing.md, paddingTop: spacing.md },

  hintWrap: { padding: spacing.xl, alignItems: "center" },
  hint: { ...typography.small, color: colors.gray[400], textAlign: "center" },

  section: { paddingHorizontal: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  sectionTitle: { ...typography.label, color: colors.gray[500], fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbInitial: { ...typography.h3, color: colors.gray[400] },
  shopThumb: { backgroundColor: colors.brand[50] },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { ...typography.label, color: colors.black, fontSize: 15 },
  rowMeta: { ...typography.tiny, color: colors.gray[500] },
  priceWrap: { alignItems: "flex-end" },
  price: { ...typography.label, color: colors.brand[600] },
  strike: { ...typography.tiny, color: colors.gray[400], textDecorationLine: "line-through" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { ...typography.tiny, color: colors.gray[600] },

  catWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  catText: { ...typography.small, color: colors.black },
  catCount: { ...typography.tiny, color: colors.brand[600], fontWeight: "700" },
});
