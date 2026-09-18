import { apiGet } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * TODAY, AND THE WEEK BEHIND IT.
 *
 * Every field below exists in `DashboardService::forTenant` on the server —
 * read out of it rather than guessed. What this app DRAWS is a subset; the
 * payload is larger, and listing all of it would be a type maintained against
 * a file nobody here edits.
 */

/** Signed % against the same figure yesterday, or null when yesterday was zero. */
export type Delta = number | null;

export interface DashboardToday {
  sales_count: number;
  revenue: number;
  /** Non-sale money in, published separately so "what I SOLD" stays answerable. */
  other_income: number;
  /**
   * Handed back over the counter today, published BESIDE the revenue it
   * reduces rather than folded into it — a refund is dated by the day it went
   * out, and netting it would silently rewrite the day the sale came in.
   */
  refunds: number;
  expenses: number;
  profit: number;
  /** Buyers served, not tickets rung. */
  customers_count: number;
  deltas: { revenue: Delta; expenses: Delta; profit: Delta };
}

export interface SalesPoint {
  /** "Mon", "Tue" — already localised to the shop's week by the server. */
  day: string;
  date: string;
  revenue: number;
  other_income: number;
  refunds: number;
  expenses: number;
  profit: number;
}

export interface OrderPipeline {
  pending: number;
  preparing: number;
  delivery: number;
  completed: number;
}

export interface MoneyOwed {
  receivable: { total: number; accounts: number };
  payable: { total: number; accounts: number };
}

export interface Dashboard {
  setup_completed: boolean;
  online_shop_enabled: boolean;
  subscription_expired: boolean;
  subscription_state: string;
  grace_ends_at: string | null;
  branch_scope: string | null;
  today: DashboardToday;
  pending_orders: number;
  low_stock_count: number;
  expiring_soon_count: number;
  products_count: number;
  /** Last 7 days, oldest first, ZERO-FILLED — the chart never has a hole. */
  sales_series: SalesPoint[];
  inventory: {
    low_stock: number;
    out_of_stock: number;
    expiring_soon: number;
    pending_pos: number;
  };
  order_pipeline: OrderPipeline;
  money_owed: MoneyOwed;
}

export const dashboardService = {
  /**
   * THE BRANCH TRAVELS AS A HEADER, NOT A QUERY PARAMETER.
   *
   * `ResolveBranch` reads `X-Branch-Id` and validates it against the tenant's
   * own branches before anything downstream sees it — a query param would have
   * been ignored in silence and every branch-scoped figure on this screen
   * would have shown the whole business while the picker said otherwise.
   *
   * `null` means all branches. That is a real choice, not the absence of one,
   * which is why `prefs` stores it rather than treating a missing key as
   * "all"; the header is simply omitted for it, which is what the server reads
   * as an owner's All-Branches view.
   */
  get: (branchId?: string | null): Promise<ApiEnvelope<Dashboard>> =>
    apiGet<Dashboard>(
      "/dashboard",
      branchId ? { headers: { "X-Branch-Id": branchId } } : undefined,
    ),
};
