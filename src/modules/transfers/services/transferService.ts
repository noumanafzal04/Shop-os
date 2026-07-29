import { apiGet, apiPost } from "../../../common/api/client";

/** One line on a transfer (product snapshot + quantity moved). */
export interface TransferItem {
  id: string;
  product_name: string;
  quantity: string | number;
}

/** A completed branch-to-branch stock move. */
export interface StockTransfer {
  id: string;
  reference: string;
  status: string;
  notes: string | null;
  from_branch?: { id: string; name: string } | null;
  to_branch?: { id: string; name: string } | null;
  items?: TransferItem[];
  created_at: string;
}

export interface TransferInput {
  from_branch_id: string;
  to_branch_id: string;
  notes?: string | null;
  items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
}

/** On-hand for one product at a single branch (cross-branch lookup row). */
export interface BranchStockRow {
  branch_id: string;
  branch: string;
  is_default: boolean;
  quantity: number;
}

export const transferService = {
  list: (page = 1) => apiGet<StockTransfer[]>("/inventory/transfers", { params: { page } }),
  create: (payload: TransferInput) => apiPost<StockTransfer>("/inventory/transfers", payload),
  // Cross-branch availability for one product — powers "check other branches".
  branchStock: (productId: string) => apiGet<BranchStockRow[]>(`/products/${productId}/branch-stock`),
};
