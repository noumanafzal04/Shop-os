import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  ArrowLeftIcon,
  ClockIcon,
  SearchIcon,
  SlidersIcon,
  StarIcon,
  StorefrontIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { Touchable } from "../../../common/ui/Touchable";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Skeleton } from "../../../common/ui/Skeleton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useLocationStore } from "../../../stores/locationStore";
import { useUniversalSearch } from "../hooks/useMarketplace";
import { formatDistance } from "../shopFacts";
import { Price } from "../../../common/ui/Price";
import { SmartImage } from "../../../common/ui/SmartImage";
import { shopInitial, useShopCover } from "../shopCover";
import { prefs } from "../../../common/utils/prefs";
import { SHORTCUTS } from "../tradeIcon";
import {
  SearchSuggestions,
  type Suggestion,
  suggestionsFrom,
} from "../components/SearchSuggestions";


type Tab = "all" | "products" | "shops";

/**
 * Universal search, reference layout: one box → result TABS
 * (All | Products | Shops) + filter chips (Open now, 4★+).
 */
export function SearchScreen() {
  const c = useColors();
  const coverFor = useShopCover();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const { lat, lng } = useLocationStore();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [topOnly, setTopOnly] = useState(false);
  const debounced = useDebouncedValue(q, 250);

  /**
   * What this person looked for before.
   *
   * Read once, on the device, and never sent anywhere — a search history is a
   * record of what somebody was thinking about, and the server has no use for
   * it.
   */
  const [recent, setRecent] = useState<string[]>([]);
  React.useEffect(() => {
    let alive = true;
    prefs.all().then((p) => alive && setRecent(p.searches ?? [])).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Remembered when the SEARCH SETTLES, not on every keystroke.
   *
   * `debounced` is the term that was actually sent, so the history holds what
   * was looked for rather than every prefix somebody typed on the way there.
   */
  React.useEffect(() => {
    if (debounced.trim().length < 2) return;
    prefs.rememberSearch(debounced).catch(() => {});
  }, [debounced]);

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

  /**
   * ── THE SIX BEST MATCHES, ABOVE THE SECTIONS ────────────────────────
   *
   * Built from the response the sections below already use: one request, two
   * presentations. Re-ranking here would be a second opinion formed with less
   * information than the server had, so the order arrives and is kept.
   *
   * On the All tab only — Products and Shops are somebody who has said which
   * KIND they want, and a mixed list is the wrong answer to that.
   */
  const suggestions = React.useMemo(() => suggestionsFrom(d), [d]);

  /** Picking one goes where it leads; a category narrows the aisle instead. */
  const openSuggestion = (s: Suggestion) => {
    if (s.kind === "category") {
      navigation.navigate("Browse", { title: s.label, filters: { category: s.label } });
      return;
    }
    // A product whose shop the search did not return has nowhere to go. Put it
    // in the box rather than swallowing the press.
    if (s.slug == null) {
      setQ(s.label);
      return;
    }
    navigation.navigate("MarketShop", { slug: s.slug });
  };

  return (
    <SafeScreen backgroundColor={c.bg}>
      {/* SearchIcon bar */}
      <View style={styles.searchRow}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeftIcon size={20} color={c.text} />
        </Pressable>
        <View style={styles.searchInput}>
          <AppTextInput
            icon={SearchIcon}
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
                onPress={() =>
                  // No `title`: the aisle puts the term in its own box now, and
                  // a heading saying the same word twice reads as a label
                  // rather than as something you can change.
                  navigation.navigate("Browse", { q: debounced })
                }
              >
                <SlidersIcon size={13} color={c.onPrimary} />
                <Text style={styles.aisleText}>Filter products</Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!searching ? (
          /*
            ── A SEARCH SCREEN WITH NOTHING ON IT YET ──────────────────

            It was one grey sentence explaining the minimum length — true, and
            the least useful thing this screen could be showing. Somebody who
            opened search either knows what they want, in which case the
            keyboard is already up, or is browsing, in which case they want
            somewhere to start.

            So: what they looked for before, and four ways in. Both are one tap
            and neither needs typing.
          */
          <View style={styles.landing}>
            {recent.length > 0 && (
              <>
                <View style={styles.landingHead}>
                  <Text style={styles.landingTitle}>Recent</Text>
                  <Touchable
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent searches"
                    onPress={() => {
                      setRecent([]);
                      prefs.forgetSearches().catch(() => {});
                    }}
                  >
                    <Text style={styles.landingClear}>Clear</Text>
                  </Touchable>
                </View>
                <View style={styles.recentWrap}>
                  {recent.map((term) => (
                    <Touchable
                      key={term}
                      style={styles.recentChip}
                      scaleTo={0.94}
                      accessibilityRole="button"
                      accessibilityLabel={`Search ${term}`}
                      onPress={() => setQ(term)}
                    >
                      <ClockIcon size={13} color={c.textMuted} />
                      <Text style={styles.recentText} numberOfLines={1}>
                        {term}
                      </Text>
                    </Touchable>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.landingTitle, styles.landingSpaced]}>Browse</Text>
            <View style={styles.tileGrid}>
              {SHORTCUTS.map((s) => {
                const Icon = s.icon;
                return (
                  <Touchable
                    key={s.key}
                    style={styles.tile}
                    scaleTo={0.95}
                    accessibilityRole="button"
                    accessibilityLabel={s.label}
                    onPress={() =>
                      navigation.navigate("Browse", { title: s.label, filters: s.filters })
                    }
                  >
                    <View style={[styles.tileIcon, s.tone === "offer" && styles.tileIconOffer]}>
                      <Icon
                        size={20}
                        color={s.tone === "offer" ? c.onPrimary : c.primary}
                      />
                    </View>
                    <Text style={styles.tileText} numberOfLines={2}>
                      {s.label}
                    </Text>
                  </Touchable>
                );
              })}
            </View>
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
            {tab === "all" && (
              <SearchSuggestions
                suggestions={suggestions}
                onPick={openSuggestion}
                onFill={setQ}
              />
            )}

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
                  <Touchable
                    key={p.id}
                    style={styles.row}
                    onPress={() => p.shop && navigation.navigate("MarketShop", { slug: p.shop.slug })}
                  >
                    <SmartImage
                      uri={p.image}
                      fallback={shopInitial(p.name)}
                      fallbackBackground={coverFor(p.id).bg}
                      fallbackColor={coverFor(p.id).fg}
                      style={styles.thumb}
                    />
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {p.shop?.business_name}
                        {p.distance_km != null ? ` · ${formatDistance(p.distance_km)}` : ""}
                      </Text>
                    </View>
                    <Price value={p.price} was={p.original_price} size="md" />
                  </Touchable>
                ))}
              </View>
            )}

            {/* Shops */}
            {showShops && shops.length > 0 && (
              <View style={styles.section}>
                {tab === "all" && <Text style={styles.sectionTitle}>Shops</Text>}
                {shops.map((s) => (
                  <Touchable
                    key={s.slug}
                    style={styles.row}
                    onPress={() => navigation.navigate("MarketShop", { slug: s.slug })}
                  >
                    <View style={[styles.thumb, styles.shopThumb]}>
                      <StorefrontIcon size={20} color={c.brand[600]} />
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
                        <StarIcon size={12} color={c.warm} />
                        <Text style={styles.ratingText}>{s.rating}</Text>
                      </View>
                    )}
                  </Touchable>
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
    borderRadius: 20,
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

  landing: { padding: spacing.md, paddingTop: spacing.sm },
  landingHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  landingTitle: { ...typography.label, color: c.text, fontSize: 13.5 },
  landingSpaced: { marginTop: spacing.lg },
  landingClear: { ...typography.tiny, color: c.primary, fontWeight: "700" },

  recentWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 17,
    paddingHorizontal: 12,
    height: 34,
  },
  recentText: { ...typography.small, color: c.text, fontSize: 13, flexShrink: 1 },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  // Four across, with the gaps taken out of the share. One row, so the whole
  // set is visible without a sideways scroll nobody knows is there.
  tile: { width: "22%", alignItems: "center", gap: 6 },
  tileIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: c.brand[50],
    alignItems: "center",
    justifyContent: "center",
  },
  tileIconOffer: { backgroundColor: c.primary },
  tileText: { ...typography.tiny, color: c.text, fontSize: 11, textAlign: "center" },

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
