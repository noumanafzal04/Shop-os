import React, { useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ArrowLeft, PackageSearch, X } from "lucide-react-native";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { AddButton } from "../../../common/ui/AddButton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { money } from "../../../common/format";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { useCartStore } from "../../../stores/cartStore";
import { useBrowse } from "../hooks/useMarketplace";
import { FilterButton, FilterSheet, activeFilterCount } from "../components/FilterSheet";
import { shopCover, shopInitial } from "../shopCover";
import type { AisleProduct, BrowseFilters } from "../services/marketplaceService";

/**
 * The aisle: everything on sale anywhere, narrowed.
 *
 * ── Why this is a screen and not a filter on an existing one ─────────
 *
 * The shop list filters SHOPS and a shop's menu filters one shop's products.
 * Neither can answer "cooking oil under Rs 900, in stock, cheapest first",
 * because that question crosses shops — and `/marketplace/products` was built
 * to answer exactly it and had no caller on this side at all.
 *
 * Putting it on the search screen instead would have meant two data sources
 * behind one list, switching on whether a filter happened to be set. A list
 * that changes where its rows come from is a list whose empty state means two
 * different things.
 */

type Params = {
  Browse:
    | { q?: string; business_type?: string; title?: string; filters?: BrowseFilters }
    | undefined;
};

export function BrowseScreen() {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const params = (useRoute().params ?? {}) as NonNullable<Params["Browse"]>;

  /**
   * What the screen was opened WITH, and what the sheet may change.
   *
   * Kept apart so Reset cannot widen a list somebody opened from "Pharmacy" to
   * every shop in the country — see `FilterSheet`'s `base`.
   */
  const base: BrowseFilters = {
    q: params.q,
    business_type: params.business_type,
  };
  // Seeded from whatever opened this screen — a home shortcut arrives with its
  // filter already set, and the sheet then shows it as on rather than as a
  // heading over an unfiltered list.
  const [filters, setFilters] = useState<BrowseFilters>(params.filters ?? { sort: "name" });
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = { ...base, ...filters, per_page: 24 };
  const list = useBrowse(query);
  const pull = usePullToRefresh(list.refetch);
  const rows: AisleProduct[] = list.data?.data ?? [];

  const cart = useCartStore();

  const add = (p: AisleProduct) => {
    if (!p.shop) return;
    const slug = p.shop.slug;

    // Refused HERE, not at checkout — the same rule the shop's own menu
    // applies, applied at the same moment.
    if (p.requires_prescription) {
      toast.warning("Prescription only", {
        detail: "This medicine needs a pharmacist. Visit the shop with your prescription.",
      });
      return;
    }

    const line = {
      product_id: p.id,
      variant_id: null,
      name: p.name,
      unit_price: Number(p.price),
      sold_by: p.sold_by,
      unit_label: p.unit,
    };

    if (!cart.wouldReplace(slug)) {
      cart.add(slug, line);
      return;
    }

    confirm
      .ask({
        title: "Start a new basket?",
        message: `Your basket has items from another shop. ${p.shop.business_name} delivers separately, so those will be removed.`,
        confirmLabel: "Start new",
        cancelLabel: "Keep my basket",
        tone: "danger",
      })
      .then((yes) => {
        if (yes) cart.add(slug, line);
      })
      .catch(() => {});
  };

  /**
   * Anything with a choice to make opens its shop instead of dropping into the
   * basket. A size or a set of modifiers picked FOR somebody is the wrong size
   * and the wrong modifiers.
   */
  const configurable = (p: AisleProduct) =>
    p.variants.length > 0 || p.modifier_groups.length > 0;

  const active = activeFilterCount(filters);

  /** The filters that are on, as chips you can take off one at a time. */
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (filters.category)
    chips.push({ key: "cat", label: filters.category, clear: () => setFilters((f) => ({ ...f, category: undefined })) });
  if (filters.business_type)
    chips.push({ key: "type", label: filters.business_type, clear: () => setFilters((f) => ({ ...f, business_type: undefined })) });
  if (filters.size)
    chips.push({ key: "size", label: filters.size, clear: () => setFilters((f) => ({ ...f, size: undefined })) });
  if (filters.min_price != null || filters.max_price != null)
    chips.push({
      key: "price",
      label: `${filters.min_price != null ? money(filters.min_price) : "Any"} – ${filters.max_price != null ? money(filters.max_price) : "Any"}`,
      clear: () => setFilters((f) => ({ ...f, min_price: null, max_price: null })),
    });
  if (filters.rating_min != null)
    chips.push({ key: "rating", label: `${filters.rating_min}★ and up`, clear: () => setFilters((f) => ({ ...f, rating_min: null })) });
  if (filters.on_sale)
    chips.push({ key: "sale", label: "On sale", clear: () => setFilters((f) => ({ ...f, on_sale: undefined })) });
  if (filters.in_stock)
    chips.push({ key: "stock", label: "In stock", clear: () => setFilters((f) => ({ ...f, in_stock: undefined })) });

  return (
    <SafeScreen backgroundColor={c.bg}>
      <View style={styles.head}>
        <Pressable
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        >
          <ArrowLeft size={19} color={c.text} strokeWidth={2.3} />
        </Pressable>
        <View style={styles.headCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {params.title ?? (params.q ? `“${params.q}”` : "All products")}
          </Text>
          <Text style={styles.sub}>
            {list.isPending ? "Looking…" : `${rows.length}${rows.length === 24 ? "+" : ""} items`}
          </Text>
        </View>
        <FilterButton count={active} onPress={() => setSheetOpen(true)} />
      </View>

      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${chip.label}`}
              onPress={chip.clear}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
              <X size={13} color={c.onPrimary} strokeWidth={2.6} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {list.isError ? (
        <LoadFailed
          what="products"
          error={list.error}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.primary} />
          }
          ListEmptyComponent={
            list.isPending ? (
              <View style={styles.loading}>
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonListRow key={i} />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <PackageSearch size={34} color={c.textMuted} strokeWidth={1.6} />
                <Text style={styles.emptyTitle}>Nothing matches</Text>
                <Text style={styles.emptyText}>
                  {active > 0
                    ? "Try widening a filter — the sheet says how many results each change would give."
                    : "There is nothing listed here yet."}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const cover = shopCover(item.id);
            const original = item.original_price;
            return (
              <Pressable
                style={styles.card}
                accessibilityRole="button"
                onPress={() =>
                  item.shop && navigation.navigate("MarketShop", { slug: item.shop.slug })
                }
              >
                <View style={[styles.thumb, !item.images[0] && { backgroundColor: cover.bg }]}>
                  {item.images[0] ? (
                    <Image source={{ uri: item.images[0] }} style={styles.img} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.initial, { color: cover.fg }]}>{shopInitial(item.name)}</Text>
                  )}
                  {item.requires_prescription && (
                    <View style={styles.rx}>
                      <Text style={styles.rxText}>Rx</Text>
                    </View>
                  )}
                  {!configurable(item) && !item.requires_prescription && (
                    <AddButton size={30} label={item.name} style={styles.add} onPress={() => add(item)} />
                  )}
                </View>

                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                {!!item.shop && (
                  <Text style={styles.shop} numberOfLines={1}>
                    {item.shop.business_name}
                  </Text>
                )}
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{money(item.price)}</Text>
                  {original != null && original > Number(item.price) && (
                    <Text style={styles.was}>{money(original)}</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        base={base}
        value={filters}
        onApply={setFilters}
      />
    </SafeScreen>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    back: {
      width: 38,
      height: 38,
      borderRadius: radius.full,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    headCopy: { flex: 1 },
    title: { ...typography.title, color: c.text, fontSize: 20 },
    sub: { ...typography.tiny, color: c.textMuted, marginTop: 1 },

    chipRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.primary,
      borderRadius: radius.full,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipText: { ...typography.tiny, color: c.onPrimary, fontWeight: "700" },

    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    col: { gap: spacing.md },
    card: { flex: 1 },
    thumb: {
      height: 128,
      borderRadius: radius.lg,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    img: { width: "100%", height: "100%" },
    initial: { fontSize: 34, fontWeight: "700" },
    add: { position: "absolute", right: 7, bottom: 7 },
    rx: {
      position: "absolute",
      left: 7,
      top: 7,
      backgroundColor: c.warm,
      borderRadius: radius.full,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    rxText: { ...typography.tiny, color: c.onWarm, fontWeight: "800" },

    name: { ...typography.label, color: c.text, fontSize: 13.5, marginTop: 7 },
    shop: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 3 },
    price: { ...typography.label, color: c.primary, fontSize: 14 },
    was: { ...typography.tiny, color: c.textMuted, textDecorationLine: "line-through" },

    loading: { gap: spacing.sm, paddingTop: spacing.sm },
    empty: { alignItems: "center", gap: 6, paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
    emptyTitle: { ...typography.h3, color: c.text, marginTop: spacing.sm },
    emptyText: { ...typography.small, color: c.textSecondary, textAlign: "center" },
  });
