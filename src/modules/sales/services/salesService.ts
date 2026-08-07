import { apiGet, apiPost } from "../../../common/api/client";
import type { Sale, SaleInput } from "../types";

export const salesService = {
  list: (params: { search?: string; page?: number }) =>
    apiGet<Sale[]>("/sales", {
      params: { search: params.search || undefined, page: params.page ?? 1 },
    }),

  create: (payload: SaleInput) => apiPost<Sale>("/sales", payload),

  cancel: (id: string, reason?: string) => apiPost<Sale>(`/sales/${id}/cancel`, { reason }),
};
