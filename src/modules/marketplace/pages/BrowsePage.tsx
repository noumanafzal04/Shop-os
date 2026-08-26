import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { nextParams, type FilterValue } from "../../../common/hooks/useUrlFilters";
import PageMeta from "../../../components/common/PageMeta";
import Pager from "../../../components/ui/pager";
import { FilterRail } from "../components/FilterRail";
import { ProductCard, ProductCardSkeleton } from "../components/ProductCard";
import { CloseIcon, FilterIcon, SearchIcon } from "../components/MarketIcons";
import { tradeLabel } from "../components/format";
import { useAisle, useAisleFacets } from "../hooks/useMarketplace";
import type { AisleFilters } from "../services/marketplaceService";

const SORTS: Array<{ value: NonNullable<AisleFilters["sort"]>; label: string }> = [
  { value: "name", label: "Alphabetical" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "discount", label: "Biggest discount" },
  { value: "rating", label: "Best rated shops" },
  { value: "newest", label: "Newest" },
];

/**
 * THE URL IS THE FILTER.
 *
 * Not component state. A shopper who narrows to "Lahore, under Rs 2,000, in
 * stock" and then opens something in a new tab, presses back, or sends the page
 * to somebody, expects all three to survive — and every one of them is broken
 * the moment the filters live in `useState`.
 *
 * It also means the header's city picker and this rail cannot disagree: they
 * are both reading and writing the same query string.
 */
const readFilters = (params: URLSearchParams): AisleFilters => {
  const num = (key: string) => (params.get(key) ? Number(params.get(key)) : undefined);

  return {
    q: params.get("q") || undefined,
    city_id: params.get("city_id") || undefined,
    business_type: params.get("business_type") || undefined,
    shop_slug: params.get("shop_slug") || undefined,
    category: params.get("category") || undefined,
    size: params.get("size") || undefined,
    min_price: num("min_price"),
    max_price: num("max_price"),
    on_sale: params.get("on_sale") === "1" || undefined,
    in_stock: params.get("in_stock") === "1" || undefined,
    rating_min: num("rating_min"),
    sort: (params.get("sort") as AisleFilters["sort"]) || "name",
    page: num("page") ?? 1,
  };
};

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const [railOpen, setRailOpen] = useState(false);

  const filters = useMemo(() => readFilters(params), [params]);

  const aisle = useAisle(filters);
  const facets = useAisleFacets(filters);

  const rows = aisle.data?.data ?? [];
  const pagination = aisle.data?.meta?.pagination;

  /**
   * Any change to a filter sends you back to page one.
   *
   * Without it, narrowing while on page four leaves a customer looking at an
   * empty grid with "page 4 of 2" underneath, which reads as no results rather
   * than as a page that no longer exists.
   */
  const patch = useCallback(
    (next: Partial<AisleFilters>) => {
      // The rule — and its one exception for `page` — lives in nextParams.
      // This screen had the only correct copy of it; the admin tenant list
      // wrote a second one weeks later and left the exception out, so its
      // pager did nothing. One implementation now, tested on its own.
      setParams(nextParams(params, next as Record<string, FilterValue>), { replace: false });
    },
    [params, setParams],
  );

  const clearAll = () => {
    const kept = new URLSearchParams();
    // The search term is what a customer typed; clearing FILTERS should not
    // silently throw away the thing they were looking for.
    if (filters.q) kept.set("q", filters.q);
    setParams(kept);
  };

  // The chips above the grid: every narrowing, each removable on its own.
  const chips = [
    filters.q && { key: "q", label: `“${filters.q}”` },
    filters.category && { key: "category", label: filters.category },
    filters.business_type && { key: "business_type", label: tradeLabel(filters.business_type) },
    filters.size && { key: "size", label: `Size ${filters.size}` },
    filters.shop_slug && { key: "shop_slug", label: filters.shop_slug },
    filters.in_stock && { key: "in_stock", label: "In stock" },
    filters.on_sale && { key: "on_sale", label: "On sale" },
    filters.rating_min && { key: "rating_min", label: `${filters.rating_min}★ & up` },
    (filters.min_price !== undefined || filters.max_price !== undefined) && {
      key: "price",
      label: `Rs ${filters.min_price ?? 0} – ${filters.max_price ?? "∞"}`,
    },
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  const dropChip = (key: string) =>
    key === "price" ? patch({ min_price: undefined, max_price: undefined }) : patch({ [key]: undefined });

  const rail = (
    <FilterRail value={filters} facets={facets.data} onChange={patch} onClear={clearAll} />
  );

  return (
    <>
      <PageMeta title="Browse — CartZe" description="Everything on sale across every shop, in one aisle." />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        <div className="flex gap-8">
          {/* ── The rail, on desktop ────────────────────────────── */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24">{rail}</div>
          </aside>

          {/* ── The grid ────────────────────────────────────────── */}
          <div className="min-w-0 flex-1">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {filters.q ? `Results for “${filters.q}”` : filters.category ?? "All products"}
                </h1>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  {aisle.isLoading
                    ? "Looking…"
                    : `${pagination?.total ?? rows.length} ${(pagination?.total ?? rows.length) === 1 ? "item" : "items"} across every shop`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRailOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-300 lg:hidden dark:border-white/10 dark:text-gray-200"
                >
                  <FilterIcon className="size-4" />
                  Filters
                  {chips.length > 0 && (
                    <span className="grid size-5 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
                      {chips.length}
                    </span>
                  )}
                </button>

                <label className="sr-only" htmlFor="aisle-sort">Sort by</label>
                <select
                  id="aisle-sort"
                  value={filters.sort}
                  onChange={(e) => patch({ sort: e.target.value as AisleFilters["sort"] })}
                  className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 outline-none transition focus:border-brand-400 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {chips.length > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => dropChip(chip.key)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 transition hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
                  >
                    {chip.label}
                    <CloseIcon className="size-3.5" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Three at `lg`, not four: the filter rail arrives at exactly
                that breakpoint and takes 288px off this column. Stated rather
                than left to `sm:` because a grid that says nothing at `lg` is
                a grid nobody checked on a tablet — see tabletLayouts.test. */}
            {aisle.isLoading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 px-6 py-20 text-center dark:border-white/10">
                <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/5">
                  <SearchIcon className="size-6" />
                </span>
                <p className="text-base font-semibold text-gray-900 dark:text-white">Nothing matched</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                  {chips.length > 0
                    ? "Try removing a filter — the counts beside each option show what is actually there."
                    : "No shop has listed anything yet. Check back soon."}
                </p>
                {chips.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="mt-4 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div
                /* Dimmed, not replaced, while the next page arrives — a grid
                   that empties to skeletons on every filter click feels like a
                   page reload rather than a filter. */
                className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 ${
                  aisle.isFetching ? "opacity-60" : ""
                }`}
              >
                {rows.map((product) => (
                  <ProductCard key={`${product.shop?.slug}-${product.id}`} product={product} />
                ))}
              </div>
            )}

            <Pager
              pagination={pagination}
              noun="products"
              onPage={(page) => {
                patch({ page });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>
        </div>
      </div>

      {/* ── The rail, on a phone ──────────────────────────────────── */}
      {railOpen && (
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-gray-950/40 backdrop-blur-sm"
          />
          <div className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 dark:bg-gray-950">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Filters</h2>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Close filters"
                className="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
            {rail}
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-brand-500 text-sm font-semibold text-white"
            >
              Show {pagination?.total ?? rows.length} products
            </button>
          </div>
        </div>
      )}
    </>
  );
}
