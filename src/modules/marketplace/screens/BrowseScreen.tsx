import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  ArrowLeftIcon,
  PackageSearchIcon,
  SearchIcon,
  XIcon,
} from "../../../common/ui/icons";
import { SafeScreen } from "../../../common/ui/SafeScreen";
import { EmptyState } from "../../../common/ui/EmptyState";
import { AppTextInput } from "../../../common/ui/AppTextInput";
import { Touchable } from "../../../common/ui/Touchable";
import { AddButton } from "../../../common/ui/AddButton";
import { LoadFailed } from "../../../common/ui/LoadFailed";
import { SkeletonListRow } from "../../../common/ui/Skeleton";
import { confirm } from "../../../common/ui/confirm";
import { toast } from "../../../common/ui/toast";
import { money } from "../../../common/format";
import { radius, spacing, type ThemeColors, typography, useColors } from "../../../theme";
import { usePullToRefresh } from "../../../common/hooks/usePullToRefresh";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useCartStore } from "../../../stores/cartStore";
import { useBrowse } from "../hooks/useMarketplace";
import { FilterSheet, activeFilterCount } from "../components/FilterSheet";
import { QuickFilters } from "../components/QuickFilters";
import { shopInitial, useShopCover } from "../shopCover";
import { SmartImage } from "../../../common/ui/SmartImage";
import { OfferBadge, Price } from "../../../common/ui/Price";
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
  const coverFor = useShopCover();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<any>();
  const params = (useRoute().params ?? {}) as NonNullable<Params["Browse"]>;

  /**
   * ── A PAGE YOU CAN TYPE ON ──────────────────────────────────────────
   *
   * The aisle had no box at all. Arriving from a home shortcut — Offers,
   * Pharmacy — you could narrow by price, rating, category and stock, and you
   * could not say the one word you came for. The only way to search was to
   * back out to the search screen and lose every filter on the way.
   *
   * Seeded from whatever opened the screen, so a term carried in from search
   * appears in the box rather than only in the heading, where it looked like a
   * label and not like something you could change.
   */
  const [term, setTerm] = useState(params.q ?? "");
  const q = useDebouncedValue(term, 300).trim();

  /**
   * What the screen was opened WITH, and what the sheet may change.
   *
   * Kept apart so Reset cannot widen a list somebody opened from "Pharmacy" to
   * every shop in the country — see `FilterSheet`'s `base`. The typed term
   * belongs on this side too: Reset clears the FILTERS, and clearing somebody's
   * search along with them is not what that word means. It also keeps the
   * sheet's live count honest, because the count is taken against `base`.
   */
  const base: BrowseFilters = {
    q: q || undefined,
    business_type: params.business_type,
  };
  // Seeded from whatever opened this screen — a home shortcut arrives with its
  // filter already set, and the sheet then shows it as on rather than as a
  // heading over an unfiltered list.
  const [filters, setFilters] = useState<BrowseFilters>(params.filters ?? { sort: "name" });
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = { ...base, ...filters, per_page: 24 };
  const list = useBrowse(query);

  /**
   * A NEW SEARCH STARTS AT THE TOP.
   *
   * Three pages down, typing a word leaves the window where it was — over a
   * shorter list, which RN clamps to the end of it. So it reads as "my search
   * returned the bottom of something", and a pull nobody expected to need.
   */
  const listRef = React.useRef<FlatList<AisleProduct>>(null);
  React.useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [q]);
  const pull = usePullToRefresh(list.refetch);
  // Every page, flattened. `pages` is what an infinite query keeps; the screen
  // wants one list.
  const rows: AisleProduct[] = (list.data?.pages ?? []).flatMap((p) => p.data);
  const total = list.data?.pages[0]?.meta?.pagination?.total ?? rows.length;

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
      image: p.images[0] ?? null,
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
        <Touchable
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        >
          <ArrowLeftIcon size={19} color={c.text} />
        </Touchable>
        <View style={styles.headCopy}>
          <AppTextInput
            icon={SearchIcon}
            placeholder={params.title ? `Search in ${params.title}` : "Search all products…"}
            value={term}
            onChangeText={setTerm}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            trailing={
              term.length > 0 ? (
                <Touchable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setTerm("")}
                >
                  <XIcon size={16} color={c.textMuted} />
                </Touchable>
              ) : null
            }
          />
        </View>
      </View>

      {/*
        WHAT THE LIST IS, and how much of it there is — under the box now
        rather than beside it, because the box took the line the heading had.

        The count is the server's own total. It used to print `24+`: the screen
        admitting it had one page and no idea what was behind it.
      */}
      <Text style={styles.sub} numberOfLines={1}>
        {params.title ? `${params.title} · ` : ""}
        {list.isPending ? "Looking…" : `${total} item${total === 1 ? "" : "s"}`}
      </Text>

      {/*
        THE FOUR QUESTIONS PEOPLE ACTUALLY ASK, one tap each.

        The Filter button used to be the only control here, so "only things on
        sale" — one tap's worth of intent — cost four: open a sheet, find the
        row, tick it, press Show. This bar is not a second filter UI; pressing a
        pill writes the identical `BrowseFilters` the sheet would have written,
        and the sheet still owns everything with more than two answers.
      */}
      <QuickFilters
        filters={filters}
        onChange={setFilters}
        onOpenAll={() => setSheetOpen(true)}
        activeCount={active}
      />

      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((chip) => (
            <Touchable
              key={chip.key}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${chip.label}`}
              onPress={chip.clear}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
              <XIcon size={13} color={c.onPrimary} />
            </Touchable>
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
          ref={listRef}
          data={rows}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={styles.col}
          contentContainerStyle={[styles.list, styles.grow]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={c.primary} />
          }
          /*
            HALF A SCREEN AHEAD. Fetching at the very bottom means the spinner
            is what somebody sees; fetching at 0.5 means the next page is
            usually already there by the time they arrive.
          */
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            // `hasNextPage` alone is not enough — `onEndReached` fires more
            // than once while a list settles, and without the in-flight check
            // that is two identical requests for page two.
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          ListFooterComponent={
            list.isFetchingNextPage ? (
              <View style={styles.more}>
                <ActivityIndicator color={c.primary} />
              </View>
            ) : !list.hasNextPage && rows.length > 0 ? (
              // An end that says so. A list that simply stops leaves somebody
              // pulling at it wondering whether it is loading.
              <Text style={styles.end}>That is everything</Text>
            ) : null
          }
          ListEmptyComponent={
            list.isPending ? (
              <View style={styles.loading}>
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonListRow key={i} />
                ))}
              </View>
            ) : (
              <EmptyState
                icon={PackageSearchIcon}
                tone="muted"
                title={q ? `Nothing matches “${q}”` : "Nothing matches"}
                message={
                  /*
                    Three different situations wore one sentence before: a word
                    that found nothing, filters that are too narrow, and a shelf
                    that is genuinely empty. Only one of them is the person's
                    fault, and only two are worth acting on.
                  */
                  q && active > 0
                    ? "Try another word, or take a filter off."
                    : q
                      ? "Try a shorter word, or a different spelling."
                      : active > 0
                        ? "Try widening a filter — the sheet says how many results each change would give."
                        : "There is nothing listed here yet."
                }
                action={active > 0 ? { label: "Clear filters", onPress: () => setFilters({}) } : undefined}
              />
            )
          }
          renderItem={({ item }) => {
            const cover = coverFor(item.id);
            const original = item.original_price;
            return (
              <Touchable
                style={styles.card}
                accessibilityRole="button"
                onPress={() =>
                  item.shop && navigation.navigate("MarketShop", { slug: item.shop.slug })
                }
              >
                <View style={styles.thumb}>
                  <SmartImage
                    uri={item.images[0] ?? null}
                    fallback={shopInitial(item.name)}
                    fallbackBackground={cover.bg}
                    fallbackColor={cover.fg}
                    style={styles.img}
                  />
                  {item.requires_prescription && (
                    <View style={styles.rx}>
                      <Text style={styles.rxText}>Rx</Text>
                    </View>
                  )}
                  {!configurable(item) && !item.requires_prescription && (
                    <AddButton size={30} label={item.name} style={styles.add} onPress={() => add(item)} />
                  )}
                  {/* Top LEFT — the add button already owns the bottom right. */}
                  <OfferBadge value={item.price} was={original} style={styles.off} />
                </View>

                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                {!!item.shop && (
                  <Text style={styles.shop} numberOfLines={1}>
                    {item.shop.business_name}
                  </Text>
                )}
                <Price value={item.price} was={original} size="sm" />
              </Touchable>
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
      borderRadius: 19,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    headCopy: { flex: 1 },
    sub: {
      ...typography.tiny,
      color: c.textMuted,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },

    chipRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.primary,
      borderRadius: 17,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipText: { ...typography.tiny, color: c.onPrimary, fontWeight: "700" },

    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },

    /** So `ListEmptyComponent` has a screen to centre in. */

    grow: { flexGrow: 1 },
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
      borderRadius: 13,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    rxText: { ...typography.tiny, color: c.onWarm, fontWeight: "800" },

    name: { ...typography.label, color: c.text, fontSize: 13.5, marginTop: 7 },
    shop: { ...typography.tiny, color: c.textMuted, marginTop: 1 },
    off: { position: "absolute", left: 6, top: 6 },

    more: { paddingVertical: spacing.lg, alignItems: "center" },
  end: {
    ...typography.tiny,
    color: c.textMuted,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  loading: { gap: spacing.sm, paddingTop: spacing.sm },
  });
