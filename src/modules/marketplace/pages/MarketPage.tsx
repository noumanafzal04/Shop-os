import { useState } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Input from "../../../components/form/input/InputField";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";
import { useCities } from "../../shop/hooks/useShop";
import { useBanners, useMarketShops } from "../hooks/useMarketplace";
import { marketplaceService, type PublicBanner } from "../services/marketplaceService";
import { MarketHeader } from "../components/MarketHeader";

/**
 * Public storefront home — city-level shop discovery.
 * Works logged-out; customers get favorites & more once signed in.
 */
export default function MarketPage() {
  const [cityId, setCityId] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);

  const cities = useCities();
  const shops = useMarketShops({ city_id: cityId, search: debounced });
  const banners = useBanners();
  const navigate = useNavigate();

  const rows = shops.data?.data ?? [];

  const onBanner = async (b: PublicBanner) => {
    // Track the click, then follow the ad's deep-link target.
    try { await marketplaceService.bannerClick(b.id); } catch { /* non-blocking */ }
    const t = b.target;
    if (t.type === "shop" && t.shop_slug) navigate(`/shop/${t.shop_slug}`);
    else if (t.type === "product" && t.shop_slug) navigate(`/shop/${t.shop_slug}`);
    else if (t.type === "url" && t.url) window.open(t.url, "_blank", "noopener");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageMeta title="CartZe Market" description="Discover local shops in your city" />
      <MarketHeader />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Promo banners (paid ads) */}
        {(banners.data?.length ?? 0) > 0 && (
          <div className="mb-6 flex gap-4 overflow-x-auto pb-1">
            {banners.data!.map((b) => (
              <button
                key={b.id}
                onClick={() => onBanner(b)}
                className="relative h-40 w-full max-w-2xl shrink-0 overflow-hidden rounded-2xl sm:h-48"
              >
                <img src={b.image_url ?? ""} alt={b.title ?? ""} className="h-full w-full object-cover" />
                {b.title && (
                  <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-left text-sm font-semibold text-white">
                    {b.title}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <h1 className="mb-1 text-2xl font-bold text-gray-800 dark:text-white/90">
          Shops near you
        </h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Pick your city and discover local businesses.
        </p>

        {/* City chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setCityId("")}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              cityId === ""
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            All cities
          </button>
          {(cities.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setCityId(c.id)}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                cityId === c.id
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-gray-300 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="mb-6 max-w-md">
          <Input
            placeholder="Search shops…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Shop grid */}
        {shops.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">
              {debounced || cityId
                ? "No shops match — try another city or search."
                : "No shops are online yet. Check back soon!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((shop) => (
              <Link
                key={shop.slug}
                to={`/shop/${shop.slug}`}
                className="group rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md dark:border-gray-800 dark:bg-white/[0.03]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-xl font-bold text-brand-500 dark:bg-brand-500/10">
                    {shop.business_name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-gray-800 group-hover:text-brand-600 dark:text-white/90">
                      {shop.business_name}
                    </h3>
                    <p className="text-theme-xs capitalize text-gray-500 dark:text-gray-400">
                      {shop.business_category ?? shop.business_type}
                      {shop.city && ` · ${shop.city.name}`}
                    </p>
                    {shop.rating !== null && (
                      <p className="text-theme-xs">
                        <span className="text-warning-400">★</span>{" "}
                        <span className="text-gray-600 dark:text-gray-300">{shop.rating}</span>
                        <span className="text-gray-400"> ({shop.reviews_count})</span>
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
