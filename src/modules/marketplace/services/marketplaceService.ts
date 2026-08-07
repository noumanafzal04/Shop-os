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

export interface RegisterPayload {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  password_confirmation: string;
}

export const marketplaceService = {
  /** GPS → nearest city (no manual picker). */
  locate: (lat: number, lng: number) =>
    apiGet<LocateResult>("/marketplace/locate", { params: { lat, lng } }),

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
