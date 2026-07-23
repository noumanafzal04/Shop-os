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
  default_categories: string[];
  default_expense_categories: string[];
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
  pos_default_payment: "cash" | "card";
  pos_auto_print: boolean;
  pos_require_shift: boolean;
  barcode_show_price: boolean;
  barcode_show_name: boolean;
  scale_barcode_enabled: boolean;
  scale_barcode_prefix: string;
  scale_barcode_mode: "weight" | "price";
}

export const shopService = {
  show: () => apiGet<Tenant>("/shop"),
  setup: (payload: SetupPayload) => apiPut<Tenant>("/shop/setup", payload),
  cities: () => apiGet<City[]>("/cities"),
  businessTypes: () => apiGet<BusinessType[]>("/business-types"),
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
