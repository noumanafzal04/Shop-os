import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export type PromoType = "percent" | "fixed";
export type PromoScope = "order" | "category" | "product";

export interface Promotion {
  id: string;
  name: string;
  type: PromoType;
  value: string | number;
  scope: PromoScope;
  category_id: string | null;
  category?: { id: string; name: string } | null;
  product_ids: string[] | null;
  min_spend: string | number | null;
  min_qty: string | number | null;
  max_discount: string | number | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  priority: number;
  is_active: boolean;
}

export interface PromotionInput {
  name: string;
  type: PromoType;
  value: number;
  scope: PromoScope;
  category_id?: string | null;
  product_ids?: string[] | null;
  min_spend?: number | null;
  min_qty?: number | null;
  max_discount?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  days_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  priority?: number;
  is_active?: boolean;
}

export interface PromoPreview {
  promotion_id: string;
  name: string;
  discount: number;
}

export const promotionsService = {
  list: () => apiGet<Promotion[]>("/promotions"),
  create: (payload: PromotionInput) => apiPost<Promotion>("/promotions", payload),
  update: (id: string, payload: Partial<PromotionInput>) => apiPut<Promotion>(`/promotions/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/promotions/${id}`),
  // POS live preview — best promotion for the current cart (display-only).
  preview: (items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>) =>
    apiPost<PromoPreview | null>("/promotions/preview", { items }),
};
