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
  unit?: string | null;
  duration_minutes: number | null;
  category: { id: string; name: string } | null;
  images: string[];
  in_stock: boolean;
  available_now: boolean;
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

  reservations: () => apiGet<CustomerReservation[]>("/customer/reservations"),

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
