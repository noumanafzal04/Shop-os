import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface IncomeCategory {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

export interface Income {
  id: string;
  income_category_id: string | null;
  description: string;
  amount: string;
  income_date: string;
  notes: string | null;
  category?: { id: string; name: string } | null;
  created_at: string;
}

export interface IncomeInput {
  income_category_id: string;
  description: string;
  amount: number;
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

  list: (params: { search?: string; category_id?: string; page?: number }) =>
    apiGet<Income[]>("/incomes", {
      params: {
        search: params.search || undefined,
        category_id: params.category_id || undefined,
        page: params.page ?? 1,
      },
    }),

  create: (payload: IncomeInput) => apiPost<Income>("/incomes", payload),
  update: (id: string, payload: IncomeInput) => apiPut<Income>(`/incomes/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/incomes/${id}`),

  cashbook: (params: { period: string; from?: string; to?: string }) =>
    apiGet<Cashbook>("/cashbook", { params }),
};
