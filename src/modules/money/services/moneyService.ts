import { apiGet, apiPost } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * WHAT THE SHOP MADE, WHAT IT OWES, AND WHAT IT SPENT.
 *
 * Three different questions with three different endpoints, and they are kept
 * apart on purpose. The platform's commission is not an expense the shop
 * chose; what a shop SOLD is not what it KEPT. Every field below was read out
 * of `ReportService::summary`, `ShopCommissionController` and
 * `StoreExpenseRequest`.
 */

export type Period = "daily" | "weekly" | "monthly" | "yearly" | "tax_year";

export interface SummaryTotals {
  sales_count: number;
  revenue: number;
  /** Handed back. Published beside revenue, never netted into it. */
  refunds: number;
  other_income: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
}

export interface SummaryPoint {
  date: string;
  revenue: number;
  other_income: number;
  expenses: number;
  profit: number;
}

export interface TopProduct {
  name: string;
  revenue: number;
  units: number;
}

export interface Summary {
  period: { from: string; to: string; granularity: string };
  totals: SummaryTotals;
  series: SummaryPoint[];
  top_products: TopProduct[];
}

export interface CommissionCharge {
  order_number: string | null;
  order_total: string | number | null;
  rate_percent: number;
  base_amount: number;
  amount: number;
  charged_at: string | null;
}

export interface CommissionInvoice {
  number: string;
  period_start: string | null;
  period_end: string | null;
  orders_count: number;
  amount: number;
  status: string;
  paid_at: string | null;
}

export interface Commission {
  rate: number;
  /** True when this shop negotiated its own rate rather than taking the default. */
  rate_is_yours: boolean;
  outstanding: number;
  charges: CommissionCharge[];
  invoices: CommissionInvoice[];
}

export interface ExpenseCategory {
  id: string;
  name: string;
}

export interface NewExpense {
  expense_category_id: string;
  description: string;
  amount: number;
  expense_date: string;
  payee?: string;
  notes?: string;
}

export const moneyService = {
  summary: (period: Period): Promise<ApiEnvelope<Summary>> =>
    apiGet<Summary>("/reports/summary", { params: { period } }),

  commission: (): Promise<ApiEnvelope<Commission>> => apiGet<Commission>("/commission"),

  expenseCategories: (): Promise<ApiEnvelope<ExpenseCategory[]>> =>
    apiGet<ExpenseCategory[]>("/expense-categories"),

  /**
   * The server takes the BRANCH from context, never from this payload — a
   * write takes its tenant and branch from where it happens, not from what the
   * client claims.
   */
  recordExpense: (expense: NewExpense): Promise<ApiEnvelope<unknown>> =>
    apiPost("/expenses", expense),
};
