import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: string | number;
  min_spend: string | number | null;
  max_discount: string | number | null;
  usage_limit: number | null;
  used_count: number;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
}

export interface CouponInput {
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_spend?: number | null;
  max_discount?: number | null;
  usage_limit?: number | null;
  starts_at?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
}

export const couponsService = {
  list: (params?: { page?: number; search?: string }) => apiGet<Coupon[]>("/coupons", { params }),
  create: (payload: CouponInput) => apiPost<Coupon>("/coupons", payload),
  update: (id: string, payload: Partial<CouponInput>) => apiPut<Coupon>(`/coupons/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/coupons/${id}`),
  validate: (code: string, subtotal: number) =>
    apiPost<{ code: string; type: string; value: number; discount: number }>("/coupons/validate", { code, subtotal }),
};
