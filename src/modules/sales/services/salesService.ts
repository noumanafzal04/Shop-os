import { apiGet } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * THE LEDGER — every sale, newest first.
 *
 * ── Where an order ENDS ──────────────────────────────────────────────
 *
 * A completed delivery lands here as a Sale. So the Orders tab is where an
 * order lives while it is still moving, and this is where it comes to rest.
 * Two lists, two stages of one thing — which is why a sale carries a channel
 * and why `online` is one of the values.
 *
 * ── Read-only, deliberately ──────────────────────────────────────────
 *
 * Cancelling or exchanging a sale moves STOCK and MONEY in several directions
 * at once, and the screen that does it needs the whole picture — the drawer,
 * the batches, the customer's khata. That is the panel. The phone shows what
 * happened; it does not undo it.
 *
 * The server returns the Sale MODEL rather than a resource, so the fields
 * below are columns plus the relations the controller eager-loads. They were
 * read out of `Tenant/SaleController` and the panel's own `sales/types.ts`,
 * not guessed — the two clients consume one endpoint and must agree about it.
 */

export type SaleStatus = "completed" | "cancelled" | "refunded" | "partially_refunded";
/**
 * The server's own five — `App\Enums\SaleChannel`, read rather than guessed.
 *
 * An earlier draft of this listed four and invented `dine_in`, which the
 * enum does not have, while missing `walk_in` and `whatsapp`, which it does.
 * Both of those are the COMMON case for a Pakistani counter, so the ledger
 * rendered raw snake_case on most of its rows.
 */
export type SaleChannel = "walk_in" | "pos" | "phone" | "whatsapp" | "online";

export interface SaleLine {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
}

export interface Sale {
  id: string;
  invoice_number: string;
  /**
   * The `OFF-…` number printed at the till when there was no server.
   *
   * Null on almost every sale. When it is set it is the ONLY number the
   * customer was given — the invoice number was assigned later, on sync — so
   * it is what they read out at the counter, and what a search has to match.
   */
  offline_number?: string | null;
  channel: SaleChannel;
  status: SaleStatus;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: string | number;
  discount: string | number;
  tax?: string | number;
  total: string | number;
  payment_method: string;
  amount_paid?: string | number;
  change_due?: string | number;
  notes?: string | null;
  sold_at: string;
  branch?: { id: string; name: string } | null;
  items?: SaleLine[];
}

export interface SaleQuery {
  search?: string;
  status?: SaleStatus;
  /** ISO dates. Absent means "no restriction", never a silent default. */
  from?: string;
  to?: string;
  page?: number;
}

/**
 * ONE PLACE THE FILTERS BECOME QUERY PARAMETERS.
 *
 * Copied in SHAPE from the panel's `saleParams`, for the reason that file
 * gives: a list and an export that build their own parameters drift, and the
 * two then disagree about what "this month's sales" means. The phone has no
 * export, so this is only the list — but it is still one function, because
 * the next caller is the one that causes the drift.
 *
 * Empty strings are dropped rather than sent. `search=` is not the same
 * request as no search at all on every backend, and relying on it being the
 * same is how a filter starts returning nothing.
 */
export function saleParams(q: SaleQuery): Record<string, string | number | undefined> {
  return {
    search: q.search?.trim() || undefined,
    status: q.status || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    page: q.page ?? 1,
  };
}

export const salesService = {
  list: (q: SaleQuery): Promise<ApiEnvelope<Sale[]>> =>
    apiGet<Sale[]>("/sales", { params: saleParams(q) }),

  show: (id: string): Promise<ApiEnvelope<Sale>> => apiGet<Sale>(`/sales/${id}`),
};
