import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

export interface ExpenseCategory {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: string;
  expense_date: string;
  category?: { id: string; name: string } | null;
}

export interface ExpenseInput {
  expense_category_id: string;
  description: string;
  amount: number;
  expense_date: string;
}

export const expensesService = {
  categories: () => apiGet<ExpenseCategory[]>("/expense-categories"),

  list: (params: { page?: number }) =>
    apiGet<Expense[]>("/expenses", { params: { page: params.page ?? 1 } }),

  create: (payload: ExpenseInput) => apiPost<Expense>("/expenses", payload),

  remove: (id: string) => apiDelete<null>(`/expenses/${id}`),
};
