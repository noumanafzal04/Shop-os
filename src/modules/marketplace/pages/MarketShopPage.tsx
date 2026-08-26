import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import Pager from "../../../components/ui/pager";
import { useAuthStore } from "../../../stores/authStore";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { MyReservations } from "../components/MyReservations";
import { ProductCard, ProductCardSkeleton } from "../components/ProductCard";
import { ShopReviews } from "../components/ShopReviews";
import { money, tradeLabel } from "../components/format";
import {
  ChevronRightIcon,
  HeartIcon,
  PinIcon,
  SearchIcon,
  StarIcon,
  TruckIcon,
} from "../components/MarketIcons";
import { useAisle, useFavorites, useMarketShop, useToggleFavorite } from "../hooks/useMarketplace";

/**
 * ONE SHOP'S OWN STOREFRONT.
 *
 * It used to be the only page in the marketplace that could sell anything: it
 * carried its own header, its own cart, its own checkout form and its own
 * modifier dialog, all inline — seven hundred lines in which the catalog was
 * the smallest part.
 *
 * All four of those now belong to the storefront rather than to this page. The
 * basket is in the frame, checkout is its own page, and options are asked for
 * on the product's page where there is room for them. What is left is what a
 * shop page should be: who this shop is, what it sells, and what people say
 * about it.
 *
 * The catalog is the SAME aisle query the rest of the market runs, narrowed to
 * this shop. One query, one card, one set of rules about what may be added —
 * rather than a second catalog implementation that drifts from the first.
 */
export default function MarketShopPage() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();

  const user = useAuthStore((s) => s.user);
  const isCustomer = user?.role === "customer";

  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, 350);
  const category = params.get("category") ?? "";
  const page = Number(params.get("page") ?? 1);

  const shop = useMarketShop(slug);
  const favorites = useFavorites(isCustomer);
  const toggleFavorite = useToggleFavorite();

  const filters = useMemo(
    () => ({
      shop_slug: slug,
      q: debounced || undefined,
      category: category || undefined,
      page,
      per_page: 24,
    }),
    [slug, debounced, category, page],
  );

  const aisle = useAisle(filters);
  const rows = aisle.data?.data ?? [];
  const pagination = aisle.data?.meta?.pagination;

  const isFavorite = (favorites.data ?? []).some((f) => f.slug === slug);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  if (shop.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">This shop isn’t available</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          It may have closed its online store.
        </p>
        <Link to="/shops" className="mt-5 inline-block rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
          Back to the market
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageMeta
        title={`${shop.data?.business_name ?? "Shop"} — CartZe`}
        description={`Order from ${shop.data?.business_name ?? "this shop"} online.`}
      />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <nav aria-label="Breadcrumb" className="mb-5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Link to="/shops" className="hover:text-brand-600">Market</Link>
          <ChevronRightIcon className="size-3.5" />
          <span className="text-gray-700 dark:text-gray-300">{shop.data?.business_name ?? "Shop"}</span>
        </nav>

        {/* ── Who this shop is ────────────────────────────────────── */}
        {shop.isLoading ? (
          <div className="h-32 animate-pulse rounded-3xl bg-gray-100 dark:bg-white/5" />
        ) : shop.data ? (
          <header className="flex flex-wrap items-center justify-between gap-5 rounded-3xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-gray-900">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand-50 text-2xl font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                {shop.data.business_name.charAt(0)}
              </span>
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl dark:text-white">
                  <span className="truncate">{shop.data.business_name}</span>
                  {shop.data.is_open_now !== undefined && (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        shop.data.is_open_now
                          ? "bg-success-50 text-success-600 dark:bg-success-500/15"
                          : "bg-error-50 text-error-600 dark:bg-error-500/15"
                      }`}
                    >
                      {shop.data.is_open_now ? "Open now" : "Closed"}
                    </span>
                  )}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>{shop.data.business_category ?? tradeLabel(shop.data.business_type)}</span>
                  {shop.data.city && (
                    <span className="flex items-center gap-1">
                      <PinIcon className="size-3.5" />
                      {shop.data.city.name}
                    </span>
                  )}
                  {shop.data.rating !== null && (
                    <span className="flex items-center gap-1 text-amber-500">
                      <StarIcon className="size-3.5" />
                      <span className="tabular-nums">{shop.data.rating}</span>
                      <span className="text-gray-400">({shop.data.reviews_count})</span>
                    </span>
                  )}
                  {(shop.data.delivery_fee ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <TruckIcon className="size-3.5" />
                      Delivery {money(shop.data.delivery_fee)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {isCustomer && (
              <button
                type="button"
                onClick={() => slug && toggleFavorite.mutate(slug)}
                aria-pressed={isFavorite}
                className={`inline-flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                  isFavorite
                    ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10"
                    : "border-gray-200 text-gray-700 hover:border-rose-300 hover:text-rose-600 dark:border-white/10 dark:text-gray-200"
                }`}
              >
                <HeartIcon className="size-4" filled={isFavorite} />
                {isFavorite ? "Following" : "Follow shop"}
              </button>
            )}
          </header>
        ) : null}

        {!shop.isLoading && shop.data?.accepts_orders === false && (
          <p className="mt-4 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-200">
            This shop isn’t taking online orders at the moment. You can still see what it sells.
          </p>
        )}

        {/* ── What it sells ───────────────────────────────────────── */}
        <section className="mt-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {category || "Everything in this shop"}
            </h2>

            <div className="relative w-full sm:w-72">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onBlur={() => setParam("q", term.trim())}
                onKeyDown={(e) => e.key === "Enter" && setParam("q", term.trim())}
                type="search"
                aria-label={`Search ${shop.data?.business_name ?? "this shop"}`}
                placeholder="Search this shop…"
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-brand-400 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </div>

          {(shop.data?.categories?.length ?? 0) > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setParam("category", "")}
                aria-pressed={category === ""}
                className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
                  category === ""
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-gray-200 text-gray-600 hover:border-brand-300 dark:border-white/10 dark:text-gray-300"
                }`}
              >
                All
              </button>
              {shop.data!.categories!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setParam("category", c.name)}
                  aria-pressed={category === c.name}
                  className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition ${
                    category === c.name
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-gray-200 text-gray-600 hover:border-brand-300 dark:border-white/10 dark:text-gray-300"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {aisle.isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-gray-300 py-16 text-center dark:border-white/10">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {debounced || category
                  ? "Nothing here matches — try clearing the search."
                  : "This shop hasn’t listed anything online yet."}
              </p>
            </div>
          ) : (
            <div className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${aisle.isFetching ? "opacity-60" : ""}`}>
              {rows.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}

          <Pager
            pagination={pagination}
            noun="products"
            onPage={(next) => {
              const merged = new URLSearchParams(params);
              merged.set("page", String(next));
              setParams(merged);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </section>

        {isCustomer && (
          <section className="mt-10">
            <MyReservations />
          </section>
        )}

        <section className="mt-12">
          <ShopReviews slug={slug} shopName={shop.data?.business_name ?? "this shop"} />
        </section>
      </div>
    </>
  );
}
