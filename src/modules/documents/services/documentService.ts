import { api, apiGet, apiPost } from "../../../common/api/client";
import { printHtmlDocument } from "../../../common/print";
import type { Sale } from "../../sales/types";

/**
 * `job_card` is the workshop's: a car in the bay, parts and labour
 * accumulating, no bill yet. It behaves like the other two — priced lines, an
 * advance, and it becomes a sale — which is exactly why it is a kind here and
 * not a parallel feature.
 */
export type DocumentKind = "quotation" | "layaway" | "job_card";

/**
 * Where the CAR is, as against where the paperwork is.
 *
 * `DocumentStatus` says whether the document is still live. This says whether
 * the customer can come and collect. A job can be `ready` and still `open`
 * until somebody pays, which is why they are two fields.
 */
export type WorkStatus = "received" | "in_progress" | "ready";
export type DocumentStatus = "open" | "converted" | "cancelled";

/** Tenders a customer can hand over as an advance. Deliberately no "credit". */
export const DEPOSIT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

export interface DocumentItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  unit_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_name: string | null;
  sku: string | null;
  quantity: string;
  unit_price: string;
  line_discount: string;
  line_total: string;
  tax_rate: string | null;
}

export interface DocumentPayment {
  id: string;
  method: string;
  amount: string;
  reference: string | null;
  note: string | null;
  paid_at: string;
}

export interface SaleDocument {
  id: string;
  kind: DocumentKind;
  /** Job card only. Null on every quotation and layaway. */
  work_status?: WorkStatus | null;
  vehicle_id?: string | null;
  vehicle?: { id: string; registration: string; make: string | null; model: string | null } | null;
  /** What the customer said is wrong, in their words. */
  complaint?: string | null;
  odometer_in?: number | null;
  promised_at?: string | null;
  number: string;
  status: DocumentStatus;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: string;
  discount: string;
  tax: string;
  tax_inclusive: boolean;
  total: string;
  deposit_paid: string;
  refunded_amount: string;
  forfeited_amount: string;
  expires_at: string | null;
  stock_reserved: boolean;
  terms: string | null;
  notes: string | null;
  sale_id: string | null;
  converted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  items?: DocumentItem[];
  payments?: DocumentPayment[];
  sale?: { id: string; invoice_number: string; sold_at: string } | null;
  /** Server-derived — never recomputed here, so the rules live in one place. */
  balance?: number;
  has_lapsed?: boolean;
}

export interface DocumentSummary {
  open_quotations: number;
  open_layaways: number;
  /** Customers' money the shop is holding. In the till, and not revenue. */
  deposits_held: number;
  layaway_value: number;
  balance_outstanding: number;
  overdue: number;
}

export interface DocumentLineInput {
  product_id: string;
  variant_id?: string | null;
  product_unit_id?: string | null;
  price_level?: "retail" | "wholesale";
  quantity: number;
  /** Intent only — the server recomputes it against its own line price. */
  line_discount?: number;
  line_discount_pct?: number;
}

export interface CreateDocumentInput {
  kind: DocumentKind;
  items: DocumentLineInput[];
  customer_name?: string;
  customer_phone?: string;
  // ── Job card only. Ignored on a quotation or a layaway. ──────────
  vehicle_id?: string;
  odometer_in?: number;
  /** What the customer said is wrong, in their words. */
  complaint?: string;
  promised_at?: string;
  discount?: number;
  expires_at?: string | null;
  terms?: string;
  notes?: string;
  deposit?: { amount: number; method?: string; reference?: string };
  /** A double-tapped advance must not take the money or the goods twice. */
  idempotency_key?: string;
}

export const documentService = {
  list: (params: {
    kind?: DocumentKind;
    status?: string;
    /** The bay board: what is in the shop at this stage right now. */
    work_status?: WorkStatus;
    search?: string;
    customer_id?: string;
    page?: number;
    /** Up to 100 (the server's cap). The bay board pulls in big pages. */
    per_page?: number;
  }) =>
    apiGet<SaleDocument[]>("/sale-documents", {
      params: {
        kind: params.kind || undefined,
        status: params.status || undefined,
        work_status: params.work_status || undefined,
        search: params.search || undefined,
        customer_id: params.customer_id || undefined,
        page: params.page ?? 1,
        per_page: params.per_page || undefined,
      },
    }),

  /**
   * Move a car along the board.
   *
   * Its own call, sending one field. A mechanic marking a car READY must not be
   * able to change its price by posting the whole document back.
   */
  setWorkStatus: (id: string, work_status: WorkStatus) =>
    apiPost<SaleDocument>(`/sale-documents/${id}/work-status`, { work_status }),

  summary: () => apiGet<DocumentSummary>("/sale-documents/summary"),

  show: (id: string) => apiGet<SaleDocument>(`/sale-documents/${id}`),

  create: (payload: CreateDocumentInput) => apiPost<SaleDocument>("/sale-documents", payload),

  deposit: (id: string, payload: { amount: number; method?: string; reference?: string; note?: string }) =>
    apiPost<{ payment: DocumentPayment; document: SaleDocument }>(`/sale-documents/${id}/deposits`, payload),

  convert: (
    id: string,
    payload: {
      payments?: Array<{ method: string; amount: number; reference?: string }>;
      payment_method?: string;
      amount_paid?: number;
      cash_session_id?: string | null;
      idempotency_key?: string;
    },
  ) => apiPost<{ sale: Sale; document: SaleDocument }>(`/sale-documents/${id}/convert`, payload),

  cancel: (
    id: string,
    payload: {
      reason?: string;
      refund_amount?: number;
      forfeit_amount?: number;
      refund_method?: string;
    },
  ) => apiPost<SaleDocument>(`/sale-documents/${id}/cancel`, payload),

  /**
   * The paper the customer takes away, rendered server-side so what's on
   * screen and what comes out of the printer cannot drift apart.
   *
   * Unlike a receipt this is NOT logged: a receipt copy is evidence of a sale
   * and therefore a control problem, while re-printing an estimate for someone
   * who mislaid it is just service.
   */
  fetchHtml: async (id: string, paper?: string): Promise<string> => {
    const res = await api.get<string>(`/sale-documents/${id}/print`, {
      params: paper ? { paper } : undefined,
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r, // keep raw HTML — don't try to JSON-parse it
    });
    return res.data;
  },

  print: async (id: string, paper?: string): Promise<void> => {
    await printHtmlDocument(await documentService.fetchHtml(id, paper));
  },
};
