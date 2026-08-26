import { Link } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { useSavedStore } from "../../../stores/savedStore";
import { ProductCard, ProductCardSkeleton } from "../components/ProductCard";
import { HeartIcon } from "../components/MarketIcons";
import { useAisle } from "../hooks/useMarketplace";

/**
 * THINGS SOMEBODY MEANT TO COME BACK TO.
 *
 * The hearts live in this browser (see `savedStore`), so this page holds a
 * list of ids and asks the server what they currently are — which matters: a
 * saved item's price, stock and 86 state all move after it was hearted, and a
 * page that rendered a snapshot would quietly show yesterday's price.
 *
 * An item whose shop takes it down simply stops coming back, and the count
 * says so rather than the page pretending it is still there.
 */
export default function SavedPage() {
  const saved = useSavedStore();
  const ids = saved.ids;

  const aisle = useAisle({ ids: ids.join(","), per_page: 60 });
  const rows = aisle.data?.data ?? [];

  return (
    <>
      <PageMeta title="Saved items — CartZe" description="Things you meant to come back to." />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Saved items</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              Kept in this browser — prices and stock are checked fresh each time you look.
            </p>
          </div>
          {ids.length > 0 && (
            <button
              type="button"
              onClick={() => saved.clear()}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-error-300 hover:text-error-600 dark:border-white/10 dark:text-gray-300"
            >
              Clear all
            </button>
          )}
        </div>

        {ids.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-300 px-6 py-20 text-center dark:border-white/10">
            <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-white/5">
              <HeartIcon className="size-6" />
            </span>
            <p className="text-base font-semibold text-gray-900 dark:text-white">Nothing saved yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
              Tap the heart on anything while you browse and it will wait for you here.
            </p>
            <Link
              to="/browse"
              className="mt-5 inline-block rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              Browse products
            </Link>
          </div>
        ) : aisle.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: Math.min(ids.length, 8) }).map((_, i) => <ProductCardSkeleton key={i} />)}
          </div>
        ) : (
          <>
            {rows.length < ids.length && (
              <p className="mb-4 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-600 dark:bg-white/5 dark:text-gray-300">
                {ids.length - rows.length} of your saved items {ids.length - rows.length === 1 ? "is" : "are"} no
                longer listed by their shop.
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {rows.map((product) => (
                <ProductCard key={`${product.shop?.slug}-${product.id}`} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
