import { apiGet, apiPut } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * THE SHOP'S OWN RULES.
 *
 * Two endpoints, and they are not the same thing: `/shop` is the business
 * record (name, hours, delivery fee) and `/shop/settings` is the merged
 * settings blob (defaults plus this shop's overrides). Saving to the wrong one
 * writes a key nothing reads.
 */

export interface BusinessHour {
  /** 0 = Sunday, matching Carbon's `dayOfWeek` on the server. */
  day: number;
  /** "09:00", or null for a day the shop is shut. */
  open: string | null;
  close: string | null;
}

export interface Shop {
  id: string;
  business_name: string;
  phone: string | null;
  delivery_fee: string | number;
  business_hours: BusinessHour[] | null;
  online_shop_enabled: boolean;
}

/** Only the keys this app edits. `allSettings()` returns far more. */
export interface ShopSettings {
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  delivery_radius_km: number | null;
  min_order_amount: number | null;
  free_delivery_threshold: number | null;
  prep_time_minutes: number | null;
  delivery_provider: string;
}

export const shopService = {
  show: (): Promise<ApiEnvelope<Shop>> => apiGet<Shop>("/shop"),

  /** The business record. `business_hours` lives here, not in settings. */
  update: (changes: Partial<Pick<Shop, "business_hours" | "delivery_fee">>) =>
    apiPut<Shop>("/shop", changes),

  settings: (): Promise<ApiEnvelope<Record<string, unknown>>> =>
    apiGet<Record<string, unknown>>("/shop/settings"),

  /**
   * The server MERGES what it is given over what is saved, so a partial
   * payload is safe and a full one is not: sending back every key this app
   * happens to know would write today's defaults into the shop's own row, and
   * the shop would stop following a default it never chose to leave.
   *
   * It also refuses to leave a shop unorderable — pickup and delivery cannot
   * both be off. That refusal is the server's and is shown as it comes.
   */
  updateSettings: (changes: Partial<ShopSettings>) =>
    apiPut<Record<string, unknown>>("/shop/settings", changes),
};
