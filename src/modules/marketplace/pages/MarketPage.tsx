import { Link, useNavigate, useSearchParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import { useCities } from "../../shop/hooks/useShop";
import { ProductCard, ProductCardSkeleton } from "../components/ProductCard";
import { ChevronRightIcon, PinIcon, StarIcon, StoreIcon, TruckIcon } from "../components/MarketIcons";
import { tradeLabel } from "../components/format";
import { useAisle, useAisleFacets, useBanners, useMarketShops } from "../hooks/useMarketplace";
import { marketplaceService, type PublicBanner } from "../services/marketplaceService";

/**
 * THE MARKET'S FRONT PAGE.
 *
 * It used to be a directory: a search box, some city chips, and a grid of shop
 * cards. Which is a page that answers "who is here" — a question no shopper
 * asks. They arrive wanting a thing, and the shop is a detail they learn on the
 * way to it.
 *
 * So the front page leads with GOODS. Deals first, because a discount is the
 * only thing on a storefront that is urgent; then the aisles, counted from the
 * real catalog so none of them is empty; then a wall of products; and the shops
 * last, for the customer who really does want to browse a particular one.
 *
 * The dark band at the top is the landing page's, deliberately: somebody who
 * walked in from there should not feel handed to a different company.
 */
export default function MarketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const cityId = params.get("city_id") ?? "";

  const cities = useCities();
  const banners = useBanners();
  const facets = useAisleFacets({ city_id: cityId || undefined });
  const deals = useAisle({ city_id: cityId || undefined, on_sale: true, in_stock: true, sort: "discount", per_page: 8 });
  const fresh = useAisle({ city_id: cityId || undefined, in_stock: true, sort: "newest", per_page: 12 });
  const shops = useMarketShops({ city_id: cityId });

  const cityName = cities.data?.find((c) => c.id === cityId)?.name;

  const onBanner = async (b: PublicBanner) => {
    try { await marketplaceService.bannerClick(b.id); } catch { /* non-blocking */ }
    const t = b.target;
    if (t.type === "product" && t.product_id) navigate(`/p/${t.product_id}`);
    else if (t.shop_slug) navigate(`/shop/${t.shop_slug}`);
    else if (t.type === "url" && t.url) window.open(t.url, "_blank", "noopener");
  };

  const keep = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(cityId ? { city_id: cityId } : {}), ...extra }).toString();

  return (
    <>
      <PageMeta
        title="CartZe Market — shop every local shop in one place"
        description="Groceries, food, medicine and more from shops near you, in one basket."
      />

      {/* ── The band ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gray-950 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(60%_120%_at_50%_0%,rgba(16,185,129,0.18),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-400">
            {cityName ? `Shopping ${cityName}` : "Every shop, one basket"}
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            The shops on your street,{" "}
            <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-brand-300 bg-clip-text text-transparent">
              open on your screen
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-white/70">
            Groceries, dinner, medicine and everything else — from real shops near you, added to one
            basket and delivered by each of them.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to={`/browse?${keep({})}`}
              className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              Browse everything
              <ChevronRightIcon className="size-4" />
            </Link>
            <Link
              to={`/browse?${keep({ on_sale: "1", in_stock: "1" })}`}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Today’s deals
            </Link>
          </div>

          {/* Cities, as a row of real counts rather than a dropdown nobody
              opens. Only the ones that actually have stock appear. */}
          {(facets.data?.cities.length ?? 0) > 1 && (
            <div className="mt-8 flex flex-wrap gap-2">
              <Link
                to="/shops"
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  cityId === "" ? "border-brand-400 bg-brand-500 text-white" : "border-white/15 text-white/70 hover:bg-white/10"
                }`}
              >
                All cities
              </Link>
              {facets.data!.cities.map((c) => (
                <Link
                  key={c.id}
                  to={`/shops?city_id=${c.id}`}
                  className={`rounded-full border px-4 py-1.5 text-sm transition ${
                    cityId === c.id ? "border-brand-400 bg-brand-500 text-white" : "border-white/15 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {c.name}
                  <span className="ml-1.5 tabular-nums opacity-60">{c.products_count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Paid placements ─────────────────────────────────────── */}
        {(banners.data?.length ?? 0) > 0 && (
          <div className="-mt-8 mb-12 flex gap-4 overflow-x-auto pb-2">
            {banners.data!.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onBanner(b)}
                className="relative h-40 w-full max-w-2xl shrink-0 overflow-hidden rounded-3xl border border-gray-200 shadow-sm sm:h-48 dark:border-white/10"
              >
                <img src={b.image_url ?? ""} alt={b.title ?? ""} className="h-full w-full object-cover" />
                {b.title && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-left text-sm font-semibold text-white">
                    {b.title}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Aisles ──────────────────────────────────────────────── */}
        {(facets.data?.categories.length ?? 0) > 0 && (
          <Section
            title="Shop by aisle"
            caption="Counted from what the shops actually have on the shelf right now"
            to={`/browse?${keep({})}`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {facets.data!.categories.slice(0, 12).map((c) => (
                <Link
                  key={c.name}
                  to={`/browse?${keep({ category: c.name })}`}
                  className="group rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40"
                >
                  <p className="truncate text-sm font-semibold text-gray-900 transition group-hover:text-brand-600 dark:text-white" title={c.name}>
                    {c.name}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {c.products_count} {c.products_count === 1 ? "item" : "items"}
                  </p>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* ── Deals ───────────────────────────────────────────────── */}
        {(deals.data?.data.length ?? 0) > 0 && (
          <Section
            title="On sale now"
            caption="Biggest discounts first, and only things a shop can actually send today"
            to={`/browse?${keep({ on_sale: "1", in_stock: "1", sort: "discount" })}`}
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {deals.data!.data.map((p) => (
                <ProductCard key={`${p.shop?.slug}-${p.id}`} product={p} />
              ))}
            </div>
          </Section>
        )}

        {/* ── The wall ────────────────────────────────────────────── */}
        <Section
          title="New in"
          caption="The latest things listed by shops near you"
          to={`/browse?${keep({ sort: "newest" })}`}
        >
          {fresh.isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : fresh.data?.data.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-gray-300 py-16 text-center dark:border-white/10">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {cityName ? `No shop in ${cityName} has listed anything yet.` : "No shop has listed anything yet."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {fresh.data!.data.map((p) => (
                <ProductCard key={`${p.shop?.slug}-${p.id}`} product={p} />
              ))}
            </div>
          )}
        </Section>

        {/* ── Kinds of shop ───────────────────────────────────────── */}
        {(facets.data?.business_types.length ?? 0) > 1 && (
          <Section title="By kind of shop">
            <div className="flex flex-wrap gap-2">
              {facets.data!.business_types.map((t) => (
                <Link
                  key={t.type ?? "other"}
                  to={`/browse?${keep({ business_type: t.type ?? "" })}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200"
                >
                  <StoreIcon className="size-4 text-brand-500" />
                  {tradeLabel(t.type)}
                  <span className="tabular-nums text-gray-400">{t.products_count}</span>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* ── The shops themselves ────────────────────────────────── */}
        <Section title="Shops near you" caption="Every one of them takes orders online">
          {shops.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-3xl bg-gray-100 dark:bg-white/5" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(shops.data?.data ?? []).map((shop) => (
                <Link
                  key={shop.slug}
                  to={`/shop/${shop.slug}`}
                  className="group flex items-center gap-4 rounded-3xl border border-gray-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 dark:border-white/10 dark:bg-gray-900 dark:hover:border-brand-500/40"
                >
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-xl font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    {shop.business_name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-900 transition group-hover:text-brand-600 dark:text-white">
                      {shop.business_name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>{tradeLabel(shop.business_type)}</span>
                      {shop.city && (
                        <span className="flex items-center gap-1">
                          <PinIcon className="size-3" />
                          {shop.city.name}
                        </span>
                      )}
                      {shop.rating !== null && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <StarIcon className="size-3" />
                          <span className="tabular-nums">{shop.rating}</span>
                          <span className="text-gray-400">({shop.reviews_count})</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <TruckIcon className="ml-auto size-5 shrink-0 text-gray-300 transition group-hover:text-brand-500 dark:text-gray-600" />
                </Link>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

/** A titled block with an optional "View all" — one shape, used six times. */
function Section({
  title,
  caption,
  to,
  children,
}: {
  title: string;
  caption?: string;
  to?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-8 lg:py-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl dark:text-white">{title}</h2>
          {caption && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{caption}</p>}
        </div>
        {to && (
          <Link
            to={to}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:text-gray-200"
          >
            View all
            <ChevronRightIcon className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
