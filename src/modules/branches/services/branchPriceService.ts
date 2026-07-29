import { apiGet, apiPut } from "../../../common/api/client";

/** One branch's product-level price override (null = uses the catalog price). */
export interface BranchPriceRow {
  branch_id: string;
  branch: string;
  is_default: boolean;
  price: string | null;
}

export interface BranchPrices {
  base_price: string;
  branches: BranchPriceRow[];
}

export const branchPriceService = {
  get: (productId: string) => apiGet<BranchPrices>(`/products/${productId}/branch-prices`),
  set: (productId: string, prices: Array<{ branch_id: string; price: number | null }>) =>
    apiPut<BranchPrices>(`/products/${productId}/branch-prices`, { prices }),
};
