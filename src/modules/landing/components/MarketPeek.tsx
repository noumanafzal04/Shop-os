import { Link } from "react-router";

import { ProductCard, ProductCardSkeleton } from "../../marketplace/components/ProductCard";
import { ChevronRightIcon } from "../../marketplace/components/MarketIcons";
import { useAisle } from "../../marketplace/hooks/useMarketplace";

/**
 * REAL SHOPS, REAL THINGS, ON THE LANDING PAGE.
 *
 * Every other section of this page is an argument about the software. This one
 * is evidence: the shops using it are open right now, and here are things you
 * can actually buy from them — the same card, the same prices and the same
 * stock the marketplace shows, because it is the same query.
 *
 * It renders NOTHING when no shop is selling. A row of empty boxes under
 * "shops already selling" is an argument against the product, and a landing
 * page has no business showing a skeleton that never fills.
 */
export function MarketPeek() {
  const aisle = useAisle({ in_stock: true, sort: "discount", per_page: 8 });
  const rows = aisle.data?.data ?? [];

  if (!aisle.isLoading && rows.length === 0) return null;

  return (
    <section id="market" className="border-b border-gray-200 bg-white dark:border-white/10 dark:bg-gray-950">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="settles flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
              Open right now
            </p>
            <h2 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-balance sm:text-5xl">
              Shops on CartZe are already selling
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
              Every shop gets a storefront with the till. Same catalog, same
              stock, same prices — so what a customer sees online is what the
              counter would sell them.
            </p>
          </div>

          <Link
            to="/shops"
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            Visit the marketplace
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {aisle.isLoading
            ? Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)
            : rows.slice(0, 8).map((p) => <ProductCard key={`${p.shop?.slug}-${p.id}`} product={p} />)}
        </div>

        <div className="mt-10 text-center">
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-6 py-3.5 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-200"
          >
            View all products
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
