import { api, apiGet, apiPost } from "../../../common/api/client";
import { printHtmlDocument } from "../../../common/print";

/** Mirrors App\Models\ReceiptPrint. */
export type ReceiptKind = "original" | "reprint" | "gift";
export type PrintStatus = "queued" | "printed" | "failed";

export interface ReceiptPrint {
  id: string;
  sale_id: string;
  kind: ReceiptKind;
  copy_no: number;
  status: PrintStatus;
  transport: string | null;
  error: string | null;
  reason: string | null;
  printed_at: string;
  user?: { id: string; name: string } | null;
  register?: { id: string; name: string } | null;
  sale?: { id: string; invoice_number: string; total: string; sold_at: string } | null;
}

export interface ReprintReport {
  from: string;
  to: string;
  rows: Array<{
    user_id: string | null;
    user_name: string;
    original: number;
    reprint: number;
    gift: number;
  }>;
}

/** What a print attempt produced, so the till can say something true about it. */
export interface PrintAttempt {
  /** The row this attempt was logged as — report the outcome against it. */
  printId: string | null;
  /** What the SERVER decided this copy is. The client never gets to choose. */
  kind: ReceiptKind;
  /** The handoff itself failed (no print dialog at all). */
  handoffError: string | null;
}

export const receiptService = {
  /**
   * Fetch the receipt HTML. Every fetch is logged server-side, and the server
   * decides whether it is an original or a stamped copy — which is why the
   * only thing a caller may ask for is a gift copy.
   */
  fetch: async (
    saleId: string,
    opts: { copy?: "gift"; reason?: string } = {},
  ): Promise<{ html: string; printId: string | null; kind: ReceiptKind }> => {
    const res = await api.get<string>(`/sales/${saleId}/invoice`, {
      params: { copy: opts.copy, reason: opts.reason },
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r, // keep raw HTML — don't try to JSON-parse it
    });
    return {
      html: res.data,
      // Exposed via config/cors.php; null if a proxy strips it, which only
      // costs us the ability to report an outcome — never the receipt.
      printId: (res.headers["x-receipt-print-id"] as string) ?? null,
      kind: ((res.headers["x-receipt-kind"] as string) ?? "original") as ReceiptKind,
    };
  },

  /**
   * Fetch + print. Resolves with the attempt either way: a receipt that never
   * reached the printer is exactly the case the counter has to handle, so it
   * is a return value, not an exception.
   */
  printReceipt: async (
    saleId: string,
    opts: { copy?: "gift"; reason?: string } = {},
  ): Promise<PrintAttempt> => {
    const { html, printId, kind } = await receiptService.fetch(saleId, opts);
    try {
      await printHtmlDocument(html);
      return { printId, kind, handoffError: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Print failed";
      // Tell the server straight away — this one we know for certain failed.
      if (printId) void receiptService.reportOutcome(printId, "failed", message);
      return { printId, kind, handoffError: message };
    }
  },

  /** The cashier's answer to "did it come out?". */
  reportOutcome: (printId: string, status: "printed" | "failed", error?: string) =>
    apiPost<ReceiptPrint>(`/receipt-prints/${printId}/outcome`, { status, error }),

  /** Every copy of one sale — who printed it, when, and why. */
  trail: (saleId: string) => apiGet<ReceiptPrint[]>(`/sales/${saleId}/receipt-prints`),

  /** Receipts the till was told never came out, and still haven't. */
  pending: () => apiGet<ReceiptPrint[]>("/receipts/pending"),

  /** Copies per cashier — the reason logging them is worth anything. */
  report: (params: { from?: string; to?: string } = {}) =>
    apiGet<ReprintReport>("/reports/reprints", { params }),

  /**
   * The receipt rendered against a sample sale, using the settings currently
   * being edited rather than the saved ones. Nothing is written.
   */
  preview: async (overrides: Record<string, string | number | boolean | string[] | null>): Promise<string> => {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides)) {
      // Arrays are never receipt settings — skip rather than stringify them
      // into a query parameter the preview endpoint would reject.
      if (v === null || v === undefined || v === "" || Array.isArray(v)) continue;
      params[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    }
    const { data } = await api.get<string>("/receipts/preview", {
      params,
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r,
    });
    return data;
  },
};
