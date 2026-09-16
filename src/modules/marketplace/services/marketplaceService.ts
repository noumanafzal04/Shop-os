import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { LoginResponse } from "../../auth/types";

export interface PublicShop {
  slug: string;
  business_name: string;
  business_type: string | null;
  business_category: string | null;
  city: { id: string; name: string } | null;
  /**
   * A PATH THE BROWSER CANNOT LOAD, and the URLs it can.
   *
   * `logo_path` is a storage path — `logos/{id}/abc.png` — and this file
   * declared only that one, so nothing on the web could draw a shop's picture
   * even if a page had tried. Nothing did: a grep for `logo` across every
   * marketplace page returns this line and nothing else, which is why the web
   * storefront is a wall of text while the phone shows photographs.
   *
   * The server has sent `logo_url` since the phone needed it and `cover_url`
   * since covers shipped. Both absolute.
   */
  logo_path: string | null;
  logo_url?: string | null;
  cover_url?: string | null;
  rating: number | null;
  reviews_count: number;
  address?: string | null;
  phone?: string | null;
  business_hours?: Array<{ day: number; open: string | null; close: string | null }> | null;
  is_open_now?: boolean;
  categories?: Array<{ id: string; name: string }>;
  features?: { delivery: boolean; reservations: boolean; services: boolean };
  delivery_fee?: number;
  /**
   * WHAT A CARD NEEDS TO BE DECIDABLE — on the wire all along, undeclared here.
   *
   * `delivers` is not the same fact as a fee of zero: one is a shop that
   * delivers free and the other is a counter you have to walk to.
   * `distance_km` and `delivers_to_me` are null unless the request carried a
   * pin, which is the other half of the same gap — see `ShopListParams`.
   */
  delivers?: boolean;
  distance_km?: number | null;
  delivers_to_me?: boolean;
  prep_time_minutes?: number | null;
  free_delivery_threshold?: number | null;
  min_order_amount?: number | null;
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
  // Sent by the server since the filters existed; nothing here declared them,
  // so the rail could not have offered the toggles even if it had wanted to.
  open_now_count: number;
  free_delivery_count: number;
}

/** Everything a page of SHOPS can be narrowed by. Every field is optional. */
export interface ShopListParams {
  city_id?: string;
  search?: string;
  lat?: number;
  lng?: number;
  business_type?: string;
  business_category?: string;
  open_now?: boolean;
  free_delivery?: boolean;
  rating_min?: number;
  /** Kilometres. Needs `lat`/`lng` — a radius with no pin means nothing. */
  radius?: number;
  sort?: "name" | "rating";
  page?: number;
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
  /**
   * WHERE THE SHOPPER IS — the fence, not a filter they set.
   *
   * The server has applied this to the aisle since the radius existed and the
   * web never sent it, so the web aisle listed goods from shops that cannot
   * reach the person reading it. See `usePin`.
   */
  lat?: number;
  lng?: number;
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
  /**
   * The two the phone has and the web did not.
   *
   * "Is it open" and "is delivery free" are the questions somebody hungry at
   * nine in the evening is asking, and the rail had no way to ask either —
   * while the server has answered both, under these exact names, all along.
   */
  open_now?: boolean;
  free_delivery?: boolean;
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
  /**
   * THE SHOP LIST — and it asked for three things out of ten.
   *
   * It sent `city_id`, `search` and `page`. The endpoint has always accepted
   * the pin, the trade, the finer category, open-now, free-delivery, a rating
   * floor, a radius and a sort — the phone sends all of them. So the web had
   * a city dropdown where the app has a location, no way to narrow a page of
   * shops to the trade the tile just promised, and no distance on any card.
   *
   * Every value is passed through as `undefined` when absent rather than as
   * an empty string: `?business_type=` reaches the server as a present, empty
   * trade, which is a different cache key for the same list.
   */
  shops: (params: ShopListParams) =>
    apiGet<PublicShop[]>("/marketplace/shops", {
      params: {
        city_id: params.city_id || undefined,
        search: params.search || undefined,
        lat: params.lat,
        lng: params.lng,
        business_type: params.business_type || undefined,
        business_category: params.business_category || undefined,
        // Sent only when ON. A `false` on the wire is a filter the server has
        // to decide the meaning of; an absent one is unambiguous.
        open_now: params.open_now ? 1 : undefined,
        free_delivery: params.free_delivery ? 1 : undefined,
        rating_min: params.rating_min ?? undefined,
        radius: params.radius ?? undefined,
        sort: params.sort || undefined,
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
  /**
   * THE PIN, and the web had none.
   *
   * `customer_addresses` has carried these columns since the marketplace
   * shipped and the phone has always sent them; this file declared neither,
   * so a web address was a sentence with no coordinates behind it. Three
   * things follow from that, and all three were live:
   *
   *   · the delivery-radius fence is only measured when a pin is present, so
   *     a web order was never fenced at all — a shop that delivers 5 km
   *     accepted an order from the next city;
   *   · the rider got a destination they could not put on a map;
   *   · and nothing on the web could be sorted or filtered by distance,
   *     because the browser never knew where the shopper was.
   *
   * Nullable, because the address box is still a sentence — see
   * `DeliveryAddressField`. The pin is something a shopper may add, not
   * something they must satisfy before they can order.
   */
  latitude: number | null;
  longitude: number | null;
  /** Exactly one of these is true at a time; the server keeps it that way. */
  is_default: boolean;
}

export interface AddressPayload {
  label?: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
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
