import { api, apiGet, apiPost } from "../../../common/api/client";
import { printHtmlDocument } from "../../../common/print";

/** The batch and expiry of what left the sender, so it arrives as the same lot. */
export interface TransferLot {
  batch_number: string;
  expiry_date: string | null;
  quantity: number | string;
}

/** One line on a transfer: what left, and — once counted in — what arrived. */
export interface TransferItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  /** Which size, where the product is sold in sizes. */
  variant_name: string | null;
  /** What was SENT — or, on a request nobody has answered yet, what was asked for. */
  quantity: string | number;
  /** What was asked for, where the transfer began as a request. Kept beside what was sent. */
  quantity_requested: string | number | null;
  /** null until the receiver has counted the line in. */
  quantity_received: string | number | null;
  short_reason: ShortReason | null;
  short_outcome: ShortOutcome | null;
  lots: TransferLot[] | null;
}

/**
 * requested   asked for by the place that needs it — nothing has moved
 * in_transit  left the sender, not yet counted in — on nobody's shelf
 * short       counted in, less arrived than left, and nobody has decided yet
 * completed   everything accounted for
 * cancelled   called back before it arrived
 */
export type TransferStatus = "requested" | "in_transit" | "short" | "completed" | "cancelled";
export type ShortReason = "missing" | "damaged";
export type ShortOutcome = "returned" | "written_off";

interface Place {
  id: string;
  name: string;
  kind: "shop" | "warehouse";
}

export interface StockTransfer {
  id: string;
  reference: string;
  status: TransferStatus;
  notes: string | null;
  from_branch?: Place | null;
  to_branch?: Place | null;
  items?: TransferItem[];
  /** Who loaded the van. Null on a request nobody has sent yet. */
  sender?: { id: string; name: string } | null;
  /** Who asked for it, where it began as a request. */
  requester?: { id: string; name: string } | null;
  receiver?: { id: string; name: string } | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  /**
   * What THIS person may do to it now. The server's answer — the rule is
   * about which place they work at, and a copy of it here would be a second
   * rule that could offer a button the server then refuses.
   */
  can?: { send: boolean; receive: boolean; settle: boolean; cancel: boolean };
}

export interface TransferInput {
  /**
   * `send`     puts it on the road for the other end to count in
   * `move`     both ends at once
   * `request`  asks the other place for it — nothing moves until they answer
   */
  mode: "send" | "move" | "request";
  from_branch_id: string;
  to_branch_id: string;
  notes?: string | null;
  items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
  /** The key the form was opened with: pressed twice, the server answers the first (AnswerOnce). */
  idempotency_key?: string;
}

export interface ReceiveInput {
  /** Only the lines that did not arrive whole. None: it arrived as it was sent. */
  items?: Array<{ id: string; quantity_received: number; short_reason?: ShortReason | null }>;
}

/** How many transfers are waiting on somebody at the place being looked at. */
export interface TransfersWaiting {
  /** Asked of this place, and not yet answered. */
  to_send: number;
  to_receive: number;
  to_settle: number;
}

/** On-hand for one product at a single place (cross-place lookup row). */
export interface BranchStockRow {
  branch_id: string;
  branch: string;
  kind?: "shop" | "warehouse";
  is_default: boolean;
  quantity: number;
}

export const transferService = {
  list: (page = 1, status?: TransferStatus) =>
    apiGet<StockTransfer[]>("/inventory/transfers", { params: { page, ...(status ? { status } : {}) } }),
  create: (payload: TransferInput) => apiPost<StockTransfer>("/inventory/transfers", payload),
  /** Answer a request. Only the lines going DIFFERENTLY from what was asked need naming. */
  send: (id: string, items?: Array<{ id: string; quantity: number }>) =>
    apiPost<StockTransfer>(`/inventory/transfers/${id}/send`, items && items.length > 0 ? { items } : {}),
  receive: (id: string, payload: ReceiveInput = {}) => apiPost<StockTransfer>(`/inventory/transfers/${id}/receive`, payload),
  settle: (id: string, outcome: ShortOutcome) => apiPost<StockTransfer>(`/inventory/transfers/${id}/settle`, { outcome }),
  cancel: (id: string) => apiPost<StockTransfer>(`/inventory/transfers/${id}/cancel`),
  /** The slip that travels with the goods, as a page. Behind auth, like every other paper. */
  slipHtml: async (id: string): Promise<string> => {
    const { data } = await api.get<string>(`/inventory/transfers/${id}/slip`, {
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r,
    });
    return data;
  },
  /** Through the panel's one print door, which fits the page to the paper first. */
  printSlip: async (id: string): Promise<void> => {
    await printHtmlDocument(await transferService.slipHtml(id));
  },
  // Cross-place availability for one product — powers "check other branches".
  branchStock: (productId: string) => apiGet<BranchStockRow[]>(`/products/${productId}/branch-stock`),
};
