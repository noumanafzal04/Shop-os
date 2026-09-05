import { apiGet, apiPost } from "../../../common/api/client";
import type { LoginResponse } from "../../auth/types";

export interface PublicShop {
  slug: string;
  business_name: string;
  business_type: string | null;
  business_category: string | null;
  city: { id: string; name: string } | null;
  logo_path: string | null;
  rating: number | null;
  reviews_count: number;
  is_open_now?: boolean;
  distance_km?: number | null;
  address?: string | null;
  phone?: string | null;
  phone_requires_login?: boolean;
  features?: { delivery: boolean; reservations: boolean; services: boolean };
  /** Whether it delivers at all — a zero fee alone cannot say. */
  delivers?: boolean;
  delivery_fee?: number;
  delivery_radius_km?: number | null;
  delivers_to_me?: boolean;
  prep_time_minutes?: number | null;
  fulfillment?: { pickup: boolean; delivery: boolean };
  min_order_amount?: number | null;
  free_delivery_threshold?: number | null;
  accepts_orders?: boolean;
  gallery?: string[];
  categories?: Array<{ id: string; name: string }>;
}

export interface LocateResult {
  city: { id: string; name: string; latitude: number; longitude: number } | null;
  distance_km?: number;
  in_service_area: boolean;
}

export interface HomeBanner {
  id: string;
  title: string | null;
  image_url: string | null;
  target: { type: "shop" | "product" | "url" | "none"; shop_slug?: string; product_id?: string; url?: string };
}

export interface DealProduct {
  id: string;
  name: string;
  price: number;
  original_price: number;
  percent_off: number;
  image: string | null;
  shop: { slug: string; business_name: string; business_type: string | null } | null;
  distance_km: number | null;
}

export interface HomeFeed {
  banners: HomeBanner[];
  nearby: PublicShop[];
  top_rated: PublicShop[];
  deals: DealProduct[];
  business_types: Array<{ type: string; shops_count: number }>;
}

export interface SearchResult {
  query: string;
  products: Array<{
    id: string;
    name: string;
    brand: string | null;
    price: number;
    original_price: number | null;
    image: string | null;
    shop: { slug: string; business_name: string; business_type: string | null } | null;
    distance_km: number | null;
  }>;
  shops: PublicShop[];
  categories: Array<{ name: string; shops_count: number }>;
}

export interface PublicModifierOption {
  id: string;
  name: string;
  price_delta: string | number;
  is_default: boolean;
}

export interface PublicModifierGroup {
  id: string;
  name: string;
  type: "modifier" | "addon";
  min_select: number;
  max_select: number;
  options: PublicModifierOption[];
}

export interface PublicProduct {
  id: string;
  type: "product" | "service";
  name: string;
  description: string | null;
  /** The selling price (sale price already applied by the server). */
  price: string | number;
  /** Regular price when a sale is active — show a strikethrough. */
  original_price: number | null;
  brand: string | null;
  /**
   * A prescription-only medicine. The server has always sent this and the app
   * never read it, so the refusal arrived at CHECKOUT — after a basket had
   * been built around an item that could never be in it.
   */
  requires_prescription?: boolean;
  unit: string | null;
  sold_by: "unit" | "weight";
  min_order_qty: number | null;
  duration_minutes: number | null;
  category: { id: string; name: string } | null;
  images: string[];
  in_stock: boolean;
  available_now: boolean;
  variants: Array<{ id: string; name: string; price: string | number; in_stock: boolean }>;
  modifier_groups: PublicModifierGroup[];
}

/**
 * Everything the aisle can be narrowed by.
 *
 * These names are the SERVER's — `/marketplace/products` validates exactly this
 * set — so a filter added on one side is a compile error on the other rather
 * than a control that silently does nothing.
 */
export interface BrowseFilters {
  q?: string;
  city_id?: string;
  business_type?: string;
  /** Pins the aisle to one shop, for a filter opened from a shop's own menu. */
  shop_slug?: string;
  item_type?: string;
  category?: string;
  size?: string;
  min_price?: number | null;
  max_price?: number | null;
  on_sale?: boolean;
  in_stock?: boolean;
  rating_min?: number | null;
  sort?: "name" | "price_asc" | "price_desc" | "newest" | "discount" | "rating";
  page?: number;
  per_page?: number;
}

/** A product in the aisle carries the shop that sells it. */
export type AisleProduct = PublicProduct & {
  shop: {
    slug: string;
    business_name: string;
    business_type: string | null;
    city: { id: string; name: string } | null;
    rating: number | null;
    delivery_fee: number;
  } | null;
};

/**
 * What is worth choosing, and how many of it.
 *
 * Each axis is counted with every OTHER filter applied but not its own, so
 * picking a different city never reads zero. `price` is the real range of the
 * current result — the slider's bounds, not a guess.
 */
export interface AisleFacets {
  total: number;
  cities: Array<{ id: string; name: string; products_count: number }>;
  business_types: Array<{ type: string | null; products_count: number }>;
  categories: Array<{ name: string; products_count: number }>;
  sizes: Array<{ name: string; products_count: number }>;
  price: { min: number; max: number };
  on_sale_count: number;
}

/** A city the marketplace actually delivers in. */
export interface MarketCity {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  shops_count: number;
}

export interface RegisterPayload {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  password_confirmation: string;
}


/**
 * A filter set, as query parameters.
 *
 * Two things this does that a spread would not:
 *
 *  - drops empty values, so an untouched filter is ABSENT rather than sent as
 *    "" — the server treats a present-but-empty axis as a real answer on one
 *    of them (`ids`), and an empty string is not what any of the others mean;
 *  - sends booleans as 1/0. `false` in a query string arrives as the STRING
 *    "false", which Laravel's `boolean` rule accepts and which is truthy —
 *    so "on sale" would switch on the moment it was switched off.
 */
function browseParams(f: BrowseFilters): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  const put = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  };
  put("q", f.q?.trim());
  put("city_id", f.city_id);
  put("business_type", f.business_type);
  put("shop_slug", f.shop_slug);
  put("item_type", f.item_type);
  put("category", f.category);
  put("size", f.size);
  put("min_price", f.min_price);
  put("max_price", f.max_price);
  put("rating_min", f.rating_min);
  put("sort", f.sort);
  put("page", f.page);
  put("per_page", f.per_page);
  if (f.on_sale) out.on_sale = 1;
  if (f.in_stock) out.in_stock = 1;
  return out;
}

export const marketplaceService = {
  /** GPS → nearest city (no manual picker). */
  locate: (lat: number, lng: number) =>
    apiGet<LocateResult>("/marketplace/locate", { params: { lat, lng } }),

  /**
   * The cities somebody can be delivered in.
   *
   * Answered from our own rows, so the location picker works whether or not a
   * geocoding key is configured — street search needs a provider, a city does
   * not, and the marketplace lists by city anyway.
   */
  cities: (q?: string) =>
    apiGet<MarketCity[]>("/marketplace/cities", { params: { q: q?.trim() || undefined } }),

  /** The whole home screen in one round trip. */
  home: (params: { lat?: number; lng?: number; city_id?: string }) =>
    apiGet<HomeFeed>("/marketplace/home", { params }),

  /** Universal search: products + shops + categories. */
  search: (q: string, params: { lat?: number; lng?: number; city_id?: string } = {}) =>
    apiGet<SearchResult>("/marketplace/search", { params: { q, ...params } }),

  bannerClick: (id: string) =>
    apiPost<{ target: HomeBanner["target"] }>(`/marketplace/banners/${id}/click`),

  shops: (params: { city_id?: string; search?: string; lat?: number; lng?: number; business_type?: string; page?: number }) =>
    apiGet<PublicShop[]>("/marketplace/shops", {
      params: {
        city_id: params.city_id || undefined,
        search: params.search || undefined,
        lat: params.lat,
        lng: params.lng,
        business_type: params.business_type || undefined,
        page: params.page ?? 1,
      },
    }),

  /**
   * The aisle: every marketplace product, filtered.
   *
   * Separate from `products(slug)` — that one is a single shop's menu and
   * takes no price or sort. This is the cross-shop list the filter sheet
   * drives, and the only endpoint that answers a price range.
   */
  browse: (f: BrowseFilters) =>
    apiGet<AisleProduct[]>("/marketplace/products", { params: browseParams(f) }),

  /** The same query, counted per axis — see `AisleFacets`. */
  facets: (f: BrowseFilters) =>
    apiGet<AisleFacets>("/marketplace/products/facets", { params: browseParams(f) }),

  shop: (slug: string, params: { lat?: number; lng?: number } = {}) =>
    apiGet<PublicShop>(`/marketplace/shops/${slug}`, { params }),

  products: (slug: string, params: { search?: string; category_id?: string; page?: number }) =>
    apiGet<PublicProduct[]>(`/marketplace/shops/${slug}/products`, {
      params: {
        search: params.search || undefined,
        category_id: params.category_id || undefined,
        page: params.page ?? 1,
      },
    }),

  /**
   * One product, by id. The list endpoint pages, so a shared link to the
   * ninetieth item on a menu cannot be answered by searching what happens to
   * be on screen — this asks for the one thing by name.
   *
   * Carries its shop, which is how a link that names only a product still
   * knows which counter it came from.
   */
  product: (id: string) =>
    apiGet<PublicProduct & { shop: PublicShop }>(`/marketplace/products/${id}`),

  register: (payload: RegisterPayload) =>
    apiPost<LoginResponse>("/auth/register", { device_name: "mobile", ...payload }),

  favorites: () => apiGet<PublicShop[]>("/customer/favorites"),

  toggleFavorite: (slug: string) =>
    apiPost<{ favorited: boolean }>(`/customer/favorites/${slug}`),

  reservations: () => apiGet<CustomerReservation[]>("/customer/reservations"),

  reserve: (payload: {
    shop_slug: string;
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    notes?: string;
  }) => apiPost<CustomerReservation>("/customer/reservations", payload),

  cancelReservation: (id: string) =>
    apiPost<CustomerReservation>(`/customer/reservations/${id}/cancel`),
};

export interface CustomerReservation {
  id: string;
  shop?: { slug: string | null; business_name: string | null };
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "completed" | "expired";
  expires_at: string | null;
  created_at: string | null;
}
