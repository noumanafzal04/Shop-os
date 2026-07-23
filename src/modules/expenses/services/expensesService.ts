import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface ExpenseCategory {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

export interface Expense {
  id: string;
  expense_category_id: string | null;
  description: string;
  amount: string;
  expense_date: string;
  notes: string | null;
  category?: { id: string; name: string } | null;
  created_at: string;
}

export interface ExpenseInput {
  expense_category_id: string;
  description: string;
  amount: number;
  expense_date: string;
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

  list: (params: { search?: string; category_id?: string; page?: number }) =>
    apiGet<Expense[]>("/expenses", {
      params: {
        search: params.search || undefined,
        category_id: params.category_id || undefined,
        page: params.page ?? 1,
      },
    }),

  create: (payload: ExpenseInput) => apiPost<Expense>("/expenses", payload),

  update: (id: string, payload: ExpenseInput) => apiPut<Expense>(`/expenses/${id}`, payload),

  remove: (id: string) => apiDelete<null>(`/expenses/${id}`),

  report: (params: { period: string; from?: string; to?: string }) =>
    apiGet<ReportSummary>("/reports/summary", { params }),

  purchasesReport: (params: { period: string }) =>
    apiGet<PurchasesReport>("/reports/purchases", { params }),
  staffReport: (params: { period: string }) =>
    apiGet<StaffReport>("/reports/staff", { params }),
  taxReport: (params: { period: string }) =>
    apiGet<TaxReport>("/reports/tax", { params }),
};

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
