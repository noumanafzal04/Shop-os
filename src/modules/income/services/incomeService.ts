import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import { toParams, type MoneyFilters } from "../../expenses/services/moneyFilters";
import type { CategoryInput } from "../../expenses/services/expensesService";

export interface IncomeCategory {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  /** What is filed here — see ExpenseCategory for why the list carries it. */
  entries_count: number;
  entries_total: number;
}

export interface Income {
  id: string;
  income_category_id: string | null;
  description: string;
  reference: string | null;
  amount: string;
  /** How it arrived. Only `cash` puts money in a drawer. */
  payment_method: string;
  /** Set when this income landed in an open drawer. */
  cash_movement_id: string | null;
  income_date: string;
  notes: string | null;
  category?: { id: string; name: string } | null;
  created_at: string;
}

export interface IncomeInput {
  income_category_id: string;
  description: string;
  reference?: string;
  amount: number;
  payment_method?: string;
  income_date: string;
  notes?: string;
}

export interface Cashbook {
  period: { from: string; to: string; granularity: string };
  opening_balance: number;
  closing_balance: number;
  totals: {
    sales_revenue: number;
    other_income: number;
    money_in: number;
    expenses: number;
    refunds: number;
    money_out: number;
    net: number;
  };
  days: Array<{
    date: string;
    sales_revenue: number;
    other_income: number;
    money_in: number;
    expenses: number;
    refunds: number;
    money_out: number;
    net: number;
    balance: number;
  }>;
}

export const incomeService = {
  categories: () => apiGet<IncomeCategory[]>("/income-categories"),

  // Same reasoning as expense categories: the buckets a business sorts its
  // money into are its own.
  createCategory: (payload: CategoryInput) =>
    apiPost<IncomeCategory>("/income-categories", payload),
  updateCategory: (id: string, payload: CategoryInput) =>
    apiPut<IncomeCategory>(`/income-categories/${id}`, payload),
  removeCategory: (id: string) => apiDelete<null>(`/income-categories/${id}`),

  list: (filters: MoneyFilters) =>
    apiGet<Income[]>("/incomes", { params: toParams(filters) }),

  create: (payload: IncomeInput) => apiPost<Income>("/incomes", payload),
  update: (id: string, payload: IncomeInput) => apiPut<Income>(`/incomes/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/incomes/${id}`),

  cashbook: (params: { period: string; from?: string; to?: string }) =>
    apiGet<Cashbook>("/cashbook", { params }),
};
