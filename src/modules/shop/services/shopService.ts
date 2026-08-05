import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { Tenant } from "../../auth/types";

export interface SetupPayload {
  business_name?: string;
  // Type is set by the admin at tenant creation — the owner never sends it.
  business_category?: string;
  city_id: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface City {
  id: string;
  name: string;
}

export interface BusinessType {
  code: string;
  label: string;
  examples: string[];
  available: boolean;
  features: Record<string, boolean>;
  item_types: string[];
  /** The categories a tenant picks WITHIN this type (its business_category). */
  categories: Array<{ value: string; label: string }>;
  /** Suggested selling units for this type (kg, plate, strip…). */
  units: string[];
  /** Suggested variant attribute names (Size, Color, Strength…). */
  variant_attributes: string[];
  default_categories: string[];
  default_expense_categories: string[];
}

/** The shop's own subscription snapshot (read-only; admin assigns plans). */
export interface SubscriptionInfo {
  plan: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    price: string | number;
    billing_period_months: number;
    online_shop_enabled: boolean;
    features: Record<string, boolean>;
  } | null;
  state: "active" | "grace" | "read_only";
  subscription_ends_at: string | null;
  grace_ends_at: string | null;
  modules: Record<string, boolean>;
  limits_usage: Array<{
    key: string;
    label: string;
    limit: number | null;
    used: number;
    remaining: number | null;
    unlimited: boolean;
    enforced: boolean;
  }>;
  payments: Array<{
    id: string;
    plan_name: string;
    amount: string;
    method: string;
    reference: string | null;
    period_start: string;
    period_end: string;
    paid_at: string;
  }>;
}

export interface GalleryImage {
  id: string;
  path: string;
  url: string | null;
  caption: string | null;
  sort_order: number;
}

export interface ShopSettings {
  currency: string;
  currency_symbol: string;
  language: string;
  default_tax_rate: number | string;
  tax_inclusive: boolean;
  /** Tenant branding. null = use the ShopOS default (brand blue). */
  theme_primary: string | null;
  theme_secondary: string | null;
  theme_tint: "none" | "subtle" | "strong";
  theme_sidebar: "light" | "tinted" | "dark";
  service_area: string | null;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  prep_time_minutes: number | string | null;
  delivery_radius_km: number | string | null;
  min_order_amount: number | string | null;
  free_delivery_threshold: number | string | null;
  invoice_header: string | null;
  invoice_footer: string | null;
  invoice_show_logo: boolean;
  receipt_width: "standard" | "thermal_80" | "thermal_58";
  receipt_show_cashier: boolean;
  /** Pakistan tax identifiers. Null for an unregistered shop — they don't print. */
  invoice_ntn: string | null;
  invoice_strn: string | null;
  invoice_fbr_pos_id: string | null;
  pos_default_payment: "cash" | "card";
  pos_auto_print: boolean;
  pos_require_shift: boolean;
  pos_drawer_kick: boolean;
  /** Lock the till after this many idle minutes. 0 = never. */
  pos_idle_lock_minutes: number;
  /** Sections a fired order routes to. Empty = one KOT for everything. */
  kitchen_stations: string[];
  kot_auto_print: boolean;
  tips_enabled: boolean;
  /** Quotations & layaway — the two promises made before a sale exists. */
  quotations_enabled: boolean;
  quotation_valid_days: number;
  quotation_terms: string | null;
  layaway_enabled: boolean;
  /** The floor under an advance, as a % of the total. 0 = accept anything. */
  layaway_min_deposit_percent: number;
  layaway_days: number;
  layaway_cancellation_fee_percent: number;
  loyalty_enabled: boolean;
  loyalty_earn_per_amount: number;
  loyalty_redeem_value: number;
  loyalty_min_redeem: number;
  barcode_show_price: boolean;
  barcode_show_name: boolean;
  scale_barcode_enabled: boolean;
  scale_barcode_prefix: string;
  scale_barcode_mode: "weight" | "price";
  /** Effective branch ceiling (null = unlimited). Drives multi-branch UI. */
  max_branches: number | null;
}

export const shopService = {
  show: () => apiGet<Tenant>("/shop"),
  setup: (payload: SetupPayload) => apiPut<Tenant>("/shop/setup", payload),
  cities: () => apiGet<City[]>("/cities"),
  businessTypes: () => apiGet<BusinessType[]>("/business-types"),
  subscription: () => apiGet<SubscriptionInfo>("/shop/subscription"),
  settings: () => apiGet<ShopSettings>("/shop/settings"),
  updateSettings: (payload: Partial<ShopSettings>) => apiPut<ShopSettings>("/shop/settings", payload),

  gallery: () => apiGet<GalleryImage[]>("/shop/gallery"),
  uploadGallery: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("images[]", f));
    return apiPost<GalleryImage[]>("/shop/gallery", fd);
  },
  deleteGalleryImage: (id: string) => apiDelete<null>(`/shop/gallery/${id}`),
};
