import React, { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Search, SlidersHorizontal, Star, Store } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Skeleton } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useLocationStore } from "../../../stores/locationStore";
import { useUniversalSearch } from "../hooks/useMarketplace";
import { formatDistance } from "../shopFacts";
import { money } from "../../../common/format";


type Tab = "all" | "products" | "shops";

/**
 * Universal search, reference layout: one box → result TABS
 * (All | Products | Shops) + filter chips (Open now, 4★+).
 */
export function SearchScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
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
    <SafeScreen backgroundColor={c.bg}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={c.text} strokeWidth={2} />
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

          <View style={styles.filters}>
            {/*
              Two chips that narrow the SHOPS already on screen — client side,
              because search returns one page and there is nothing else to
              filter. Honest about their scope and cheap.
            */}
            {showShops && (
              <>
                <FilterChip label="Open now" on={openOnly} onPress={() => setOpenOnly((v) => !v)} />
                <FilterChip label="4★ & up" on={topOnly} onPress={() => setTopOnly((v) => !v)} />
              </>
            )}
            {/*
              And the door to the real thing: price, category, stock and sort,
              applied by the SERVER across every shop. That question cannot be
              answered by filtering a page of results, which is why it is a
              different screen and not a third chip.
            */}
            {showProducts && (
              <Pressable
                style={styles.aisle}
                accessibilityRole="button"
                onPress={() => navigation.navigate("Browse", { q: debounced, title: debounced })}
              >
                <SlidersHorizontal size={13} color={c.onPrimary} strokeWidth={2.6} />
                <Text style={styles.aisleText}>Filter products</Text>
              </Pressable>
            )}
          </View>
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
                ) : results.isError ? (
          // A search that failed is not a search that found nothing. "0 results
          // for biryani" is a claim about the catalogue; this is a claim about
          // the request, and only one of them is worth retrying.
          <LoadFailed
            what="search results"
            error={results.error}
            onRetry={() => results.refetch()}
            retrying={results.isFetching}
          />
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
                        {p.distance_km != null ? ` · ${formatDistance(p.distance_km)}` : ""}
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
                      <Store size={20} color={c.brand[600]} strokeWidth={2} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{s.business_name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {s.business_type}
                        {s.distance_km != null ? ` · ${formatDistance(s.distance_km)}` : ""}
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
                  {categories.map((cat) => (
                    <Pressable key={cat.name} style={styles.catChip} onPress={() => setQ(cat.name)}>
                      <Text style={styles.catText}>{cat.name}</Text>
                      <Text style={styles.catCount}>{cat.shops_count}</Text>
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
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={[styles.filter, on && styles.filterOn]} onPress={onPress}>
      <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: { flex: 1 },

  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingHorizontal: spacing.md,
  },
  tabBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  tabText: { ...typography.label, color: c.gray[400], fontSize: 14 },
  tabTextOn: { color: c.brand[700] },
  tabLine: {
    position: "absolute",
    bottom: -1,
    left: spacing.sm,
    right: spacing.sm,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: c.brand[500],
  },

  aisle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: c.primary,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  aisleText: { ...typography.tiny, color: c.onPrimary, fontWeight: "800" },
  filters: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  filterOn: { backgroundColor: c.brand[500], borderColor: c.brand[500] },
  filterText: { ...typography.tiny, color: c.gray[600], fontWeight: "600" },
  filterTextOn: { color: c.white },

  resultCount: { ...typography.h3, color: c.text, fontSize: 16, paddingHorizontal: spacing.md, paddingTop: spacing.md },

  hintWrap: { padding: spacing.xl, alignItems: "center" },
  hint: { ...typography.small, color: c.gray[400], textAlign: "center" },

  section: { paddingHorizontal: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  sectionTitle: { ...typography.label, color: c.gray[500], fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: c.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbInitial: { ...typography.h3, color: c.gray[400] },
  shopThumb: { backgroundColor: c.brand[50] },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { ...typography.label, color: c.text, fontSize: 15 },
  rowMeta: { ...typography.tiny, color: c.gray[500] },
  priceWrap: { alignItems: "flex-end" },
  price: { ...typography.label, color: c.brand[600] },
  strike: { ...typography.tiny, color: c.gray[400], textDecorationLine: "line-through" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { ...typography.tiny, color: c.gray[600] },

  catWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  catChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  catText: { ...typography.small, color: c.text },
  catCount: { ...typography.tiny, color: c.brand[600], fontWeight: "700" },
});
