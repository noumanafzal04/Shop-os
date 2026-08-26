import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
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
  address?: string | null;
  phone?: string | null;
  business_hours?: Array<{ day: number; open: string | null; close: string | null }> | null;
  is_open_now?: boolean;
  categories?: Array<{ id: string; name: string }>;
  features?: { delivery: boolean; reservations: boolean; services: boolean };
  delivery_fee?: number;
  accepts_orders?: boolean;
  service_area?: string | null;
  gallery?: string[];
}

export interface PublicBanner {
  id: string;
  title: string | null;
  image_url: string | null;
  target: { type: "shop" | "product" | "url" | "none"; shop_slug?: string; product_id?: string; url?: string };
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  replied_at: string | null;
  customer_name: string;
  created_at: string;
}

/**
 * A review of MINE, which the public list cannot tell me about.
 *
 * The public payload carries a display name and nothing else — deliberately,
 * because it is the same for every visitor and cacheable. So "which of these
 * did I write" is a question only the customer's own endpoint can answer, and
 * until it did, the Remove button had nothing to point at.
 */
export interface MyReview {
  id: string;
  shop_slug: string | null;
  shop_name: string | null;
  rating: number;
  comment: string | null;
  reply: string | null;
  replied_at: string | null;
  created_at: string;
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
  price: string | number;
  original_price?: number | null;
  brand?: string | null;
  generic_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  /** A pharmacy item the counter may not hand over without a script. */
  requires_prescription?: boolean;
  unit?: string | null;
  sold_by?: string | null;
  min_order_qty?: number | null;
  duration_minutes: number | null;
  category: { id: string; name: string } | null;
  images: string[];
  in_stock: boolean;
  available_now: boolean;
  /**
   * Turned off by the counter tonight — 86'd.
   *
   * Published rather than filtered out, and it is NOT the same as out of
   * stock: the shop has this normally, and the flag is undone when the next
   * delivery lands. These three fields were all on the wire and missing from
   * this type, so the storefront could not tell a customer WHY something
   * could not be bought — it could only fail at checkout.
   */
  sold_out?: boolean;
  available_from?: string | null;
  available_until?: string | null;
  variants: Array<{ id: string; name: string; price: string | number; in_stock: boolean }>;
  modifier_groups: PublicModifierGroup[];
}

export interface RegisterPayload {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  password_confirmation: string;
}

/**
 * A product as it appears in the AISLE — the same public payload the shop's
 * own catalog returns, plus the shop that sells it, because a row that cannot
 * say whose shelf it is on is not a marketplace row.
 */
export interface AisleProduct extends PublicProduct {
  shop: {
    slug: string;
    business_name: string;
    business_type: string | null;
    city: { id: string; name: string } | null;
    rating: number | null;
    delivery_fee: number;
  } | null;
}

/** The single product page: the item, its shop, and somewhere to go next. */
export interface ProductDetail extends PublicProduct {
  shop: PublicShop;
  also_from_this_shop: Array<{
    id: string;
    name: string;
    price: string | number;
    original_price: number | null;
    images: string[];
    shop_slug: string;
  }>;
}

/**
 * Every filter the rail can offer, and how many rows each one produces.
 *
 * Counted server-side from the same query the listing runs — an option with a
 * number beside it that turns out to be wrong is worse than an option with no
 * number, because the first time it lies the whole rail stops being believed.
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

/** Everything the aisle can be narrowed by. Every field is optional. */
export interface AisleFilters {
  q?: string;
  /**
   * A named set, comma-separated — what the saved list asks for.
   *
   * An EMPTY string here means "none of them", not "no filter", which is why
   * `aisleParams` below must not strip it. A saved page whose last heart was
   * removed asks for nothing and must be answered with nothing.
   */
  ids?: string;
  city_id?: string;
  business_type?: string;
  shop_slug?: string;
  category?: string;
  item_type?: string;
  size?: string;
  min_price?: number;
  max_price?: number;
  on_sale?: boolean;
  in_stock?: boolean;
  rating_min?: number;
  sort?: "name" | "price_asc" | "price_desc" | "newest" | "discount" | "rating";
  page?: number;
  per_page?: number;
}

/**
 * Drop everything the server would ignore.
 *
 * An empty string is not "no filter" to a query string — `?category=` reaches
 * the server as a present, empty category and validates as a string, so the
 * request key differs from the unfiltered one and the cache treats them as two
 * pages of the same list.
 */
export const aisleParams = (f: AisleFilters): Record<string, string | number | undefined> => {
  const out: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(f)) {
    // `ids` is the one axis where an empty string is an answer. See above.
    if (key === "ids" && typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (value === undefined || value === null || value === "" || value === false) continue;
    out[key] = typeof value === "boolean" ? 1 : (value as string | number);
  }

  return out;
};

export const marketplaceService = {
  shops: (params: { city_id?: string; search?: string; page?: number }) =>
    apiGet<PublicShop[]>("/marketplace/shops", {
      params: {
        city_id: params.city_id || undefined,
        search: params.search || undefined,
        page: params.page ?? 1,
      },
    }),

  shop: (slug: string) => apiGet<PublicShop>(`/marketplace/shops/${slug}`),

  /** The aisle: every shop's shelves at once. */
  browse: (filters: AisleFilters) =>
    apiGet<AisleProduct[]>("/marketplace/products", { params: aisleParams(filters) }),

  /** What the rail may offer, counted from the same query the aisle runs. */
  facets: (filters: AisleFilters) =>
    apiGet<AisleFacets>("/marketplace/products/facets", {
      // Paging says nothing about which options exist.
      params: aisleParams({ ...filters, page: undefined, per_page: undefined, sort: undefined }),
    }),

  product: (id: string) => apiGet<ProductDetail>(`/marketplace/products/${id}`),

  banners: (placement = "home") => apiGet<PublicBanner[]>("/marketplace/banners", { params: { placement } }),
  bannerClick: (id: string) => apiPost<{ target: PublicBanner["target"] }>(`/marketplace/banners/${id}/click`),

  products: (slug: string, params: { search?: string; category_id?: string; page?: number }) =>
    apiGet<PublicProduct[]>(`/marketplace/shops/${slug}/products`, {
      params: { search: params.search || undefined, category_id: params.category_id || undefined, page: params.page ?? 1 },
    }),

  register: (payload: RegisterPayload) =>
    apiPost<LoginResponse>("/auth/register", { device_name: "web", ...payload }),

  favorites: () => apiGet<PublicShop[]>("/customer/favorites"),

  toggleFavorite: (slug: string) =>
    apiPost<{ favorited: boolean }>(`/customer/favorites/${slug}`),

  reviews: (slug: string, page = 1) =>
    apiGet<PublicReview[]>(`/marketplace/shops/${slug}/reviews`, { params: { page } }),

  submitReview: (payload: { shop_slug: string; rating: number; comment?: string }) =>
    apiPost<PublicReview>("/customer/reviews", payload),

  myReviews: () => apiGet<MyReview[]>("/customer/reviews"),

  deleteReview: (id: string) => apiDelete(`/customer/reviews/${id}`),

  // ── The buyer's own saved places and bookings ─────────────────────
  //
  // Both of these were built on the server and never called from here, which
  // is the same shape of bug this codebase keeps producing: the capability
  // exists, one link is missing, and nothing fails. What it cost was small and
  // constant — an address retyped on every order, and a reservation nobody
  // could look at after making it.

  addresses: () => apiGet<SavedAddress[]>("/customer/addresses"),

  saveAddress: (payload: AddressPayload) =>
    apiPost<SavedAddress>("/customer/addresses", payload),

  updateAddress: (id: string, payload: AddressPayload) =>
    apiPut<SavedAddress>(`/customer/addresses/${id}`, payload),

  deleteAddress: (id: string) => apiDelete<null>(`/customer/addresses/${id}`),

  /**
   * A page of them, newest first.
   *
   * It took no argument at all, while the server has always answered
   * `paginate(15)` — so a buyer with sixteen reservations could not see the
   * sixteenth, could not cancel it, and had no sign it existed. The ones that
   * fall off are the OLDEST, which is exactly where a forgotten hold sits: the
   * shop is still keeping a fridge off its shelf for somebody whose only way to
   * say "never mind" has scrolled out of reach.
   */
  reservations: (page = 1) =>
    apiGet<CustomerReservation[]>("/customer/reservations", { params: { page } }),

  cancelReservation: (id: string) =>
    apiPost<CustomerReservation>(`/customer/reservations/${id}/cancel`),
};

/** One place this buyer has had something delivered to before. */
export interface SavedAddress {
  id: string;
  /** What they call it — "Home", "Office". Optional; the address is the point. */
  label: string | null;
  address: string;
  city?: { id: string; name: string } | null;
  /** Exactly one of these is true at a time; the server keeps it that way. */
  is_default: boolean;
}

export interface AddressPayload {
  label?: string;
  address: string;
  is_default?: boolean;
}

/** A buyer's own view of something they asked a shop to hold for them. */
export interface CustomerReservation {
  id: string;
  shop: { slug: string | null; business_name: string | null };
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string | number;
  status: string;
  expires_at: string | null;
  created_at: string | null;
}
