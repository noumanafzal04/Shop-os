import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import { toParams, type MoneyFilters } from "./moneyFilters";

export interface ExpenseCategory {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

/** Creating or renaming a category. `is_active` retires one without erasing history. */
export interface CategoryInput {
  name: string;
  is_active?: boolean;
}

/** Only `cash` moves a drawer — the rest leave the till alone. */
export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash (from till)" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "credit", label: "On credit" },
  { value: "other", label: "Other" },
] as const;

export interface Expense {
  id: string;
  expense_category_id: string | null;
  supplier_id: string | null;
  description: string;
  reference: string | null;
  amount: string;
  payment_method: string;
  /** Set when this expense took cash out of an open drawer. */
  cash_movement_id: string | null;
  expense_date: string;
  notes: string | null;
  attachment_path: string | null;
  /** Ready-to-open URL for the receipt, resolved server-side. */
  attachment_url: string | null;
  recurring_expense_id: string | null;
  category?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
  created_at: string;
}

export interface ExpenseInput {
  expense_category_id: string;
  supplier_id?: string | null;
  description: string;
  reference?: string;
  amount: number;
  payment_method?: string;
  expense_date: string;
  notes?: string;
}

/** A category's ceiling for a month, and how it is tracking. */
export interface BudgetRow {
  expense_category_id: string;
  category: string;
  /** null = unbudgeted, which is not the same as a budget of zero. */
  budget: number | null;
  spent: number;
  remaining: number | null;
  over: boolean;
}

export interface RecurringExpense {
  id: string;
  expense_category_id: string;
  supplier_id: string | null;
  description: string;
  amount: string;
  payment_method: string;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  next_due_on: string;
  last_posted_on: string | null;
  is_active: boolean;
  notes: string | null;
  is_due: boolean;
  category?: { id: string; name: string } | null;
  supplier?: { id: string; name: string } | null;
}

export interface RecurringInput {
  expense_category_id: string;
  description: string;
  amount: number;
  payment_method?: string;
  frequency: string;
  next_due_on: string;
  supplier_id?: string | null;
  is_active?: boolean;
  notes?: string;
}

export interface ReportSummary {
  period: { from: string; to: string; granularity: string };
  totals: {
    sales_count: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    expenses: number;
    net_profit: number;
  };
  series: Array<{ date: string; revenue: number; expenses: number; profit: number }>;
  top_products: Array<{ name: string; units: number; revenue: number }>;
  expenses_by_category: Array<{ category: string; total: number }>;
}

export const expensesService = {
  categories: () => apiGet<ExpenseCategory[]>("/expense-categories"),

  // The categories a shop files its money under are ITS categories — seeded
  // from the business type as a starting point, not a fixed list. Without a
  // way to change them the seeded twenty are the whole vocabulary a business
  // gets to describe itself in, forever.
  createCategory: (payload: CategoryInput) =>
    apiPost<ExpenseCategory>("/expense-categories", payload),
  updateCategory: (id: string, payload: CategoryInput) =>
    apiPut<ExpenseCategory>(`/expense-categories/${id}`, payload),
  removeCategory: (id: string) => apiDelete<null>(`/expense-categories/${id}`),

  list: (filters: MoneyFilters) =>
    apiGet<Expense[]>("/expenses", { params: toParams(filters) }),

  create: (payload: ExpenseInput) => apiPost<Expense>("/expenses", payload),

  update: (id: string, payload: ExpenseInput) => apiPut<Expense>(`/expenses/${id}`, payload),

  remove: (id: string) => apiDelete<null>(`/expenses/${id}`),

  attach: (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return apiPost<Expense>(`/expenses/${id}/attachment`, body, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  detach: (id: string) => apiDelete<Expense>(`/expenses/${id}/attachment`),

  budgets: (month?: string) => apiGet<BudgetRow[]>("/expenses/budgets", { params: { month } }),
  setBudget: (payload: { expense_category_id: string; amount: number | null; month?: string }) =>
    apiPost<unknown>("/expenses/budgets", payload),

  recurring: (due = false) =>
    apiGet<RecurringExpense[]>("/expenses/recurring", { params: { due: due ? 1 : undefined } }),
  createRecurring: (payload: RecurringInput) => apiPost<RecurringExpense>("/expenses/recurring", payload),
  updateRecurring: (id: string, payload: Partial<RecurringInput>) =>
    apiPut<RecurringExpense>(`/expenses/recurring/${id}`, payload),
  removeRecurring: (id: string) => apiDelete<null>(`/expenses/recurring/${id}`),
  postRecurring: (id: string, payload: { amount?: number; payment_method?: string; reference?: string }) =>
    apiPost<Expense>(`/expenses/recurring/${id}/post`, payload),

  report: (params: { period: string; from?: string; to?: string }) =>
    apiGet<ReportSummary>("/reports/summary", { params }),

  purchasesReport: (params: { period: string }) =>
    apiGet<PurchasesReport>("/reports/purchases", { params }),
  staffReport: (params: { period: string }) =>
    apiGet<StaffReport>("/reports/staff", { params }),
  taxReport: (params: { period: string }) =>
    apiGet<TaxReport>("/reports/tax", { params }),

  /** What each item actually earned — revenue crowns the expensive, margin crowns what pays. */
  marginsReport: (params: { period: string }) =>
    apiGet<MarginsReport>("/reports/margins", { params }),
  /** What the shelves are worth. Branch-scoped by the active branch header. */
  valuationReport: () => apiGet<ValuationReport>("/reports/valuation"),
  /** Stock nobody has bought inside the window. */
  deadStockReport: (params: { days: number }) =>
    apiGet<DeadStockReport>("/reports/dead-stock", { params }),
};

export interface MarginLine {
  name: string;
  category: string;
  units: number;
  revenue: number;
  cogs: number;
  profit: number;
  /** Null when nothing was taken — 0% would read as break-even on a giveaway. */
  margin_pct: number | null;
}

export interface MarginsReport {
  period: { from: string; to: string };
  totals: { revenue: number; cogs: number; profit: number; margin_pct: number | null };
  best: MarginLine[];
  /** Sold below cost — almost always a costing mistake, invisible in a revenue ranking. */
  losing: MarginLine[];
  by_category: Array<{ category: string; revenue: number; cogs: number; profit: number; margin_pct: number | null }>;
}

export interface ValuationReport {
  branch_scope: string | null;
  totals: {
    lines: number;
    units: number;
    cost_value: number;
    retail_value: number;
    potential_profit: number;
    /** In the retail figure but not the cost one — the margin above is optimistic by this much. */
    uncosted_items: number;
    uncosted_units: number;
  };
  by_category: Array<{ category: string; units: number; cost_value: number; retail_value: number }>;
  items: Array<{
    product_id: string;
    variant_id: string | null;
    name: string;
    sku: string | null;
    category: string;
    quantity: number;
    cost: number | null;
    cost_value: number;
    retail_value: number;
  }>;
}

export interface DeadStockReport {
  branch_scope: string | null;
  days: number;
  totals: { lines: number; units: number; value: number; never_sold: number };
  items: Array<{
    product_id: string;
    name: string;
    sku: string | null;
    category: string;
    quantity: number;
    cost: number;
    value: number;
    /** Null means it has NEVER sold — a buying mistake, not a selling one. */
    last_sold_at: string | null;
    days_idle: number | null;
  }>;
}

export interface PurchasesReport {
  period: { from: string; to: string };
  totals: { orders: number; ordered_value: number; paid: number; outstanding: number };
  by_supplier: Array<{ supplier: string; orders: number; total: number; outstanding: number }>;
}

export interface StaffReport {
  period: { from: string; to: string };
  staff: Array<{ staff_id: string; name: string; sales_count: number; revenue: number }>;
}

export interface TaxReport {
  period: { from: string; to: string };
  totals: { taxable_sales: number; net_sales: number; tax_collected: number; gross_sales: number };
}
