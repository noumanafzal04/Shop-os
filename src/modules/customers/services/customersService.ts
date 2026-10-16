import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface LedgerEntry {
  id: string;
  type: "charge" | "payment" | "adjustment";
  amount: string | number;
  balance_after: string | number;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
  /** The sale a charge (or its return) belongs to — so the line can open it. */
  sale?: { id: string; invoice_number: string } | null;
  /** The installment plan whose sale this is (F1), so the line says so. */
  plan?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  last_seen_at: string | null;
  // Tiered-pricing group (retail/wholesale + members' discount).
  customer_group_id?: string | null;
  group?: { id: string; name: string; price_level: string; discount_percent: string | number | null } | null;
  // Sell-on-credit (khata): what they owe now + the optional cap.
  credit_balance?: string | number;
  credit_limit?: string | number | null;
  // Loyalty points balance + statement.
  loyalty_points?: number;
  loyalty_ledger?: LoyaltyLedgerEntry[];
  sales_count?: number;
  sales_total?: string | number | null;
  /** When they last handed money over against the khata (not a return). */
  last_paid_at?: string | null;
  history?: {
    sales: Array<{ id: string; invoice_number: string; total: string | number; channel: string; sold_at: string }>;
    orders: Array<{ id: string; order_number: string; total: string | number; status: string; placed_at: string }>;
    total_spent: number;
    orders_count: number;
  };
  ledger?: LedgerEntry[];
  /** Goods on installments (F1), running ones first, each as it stands today. */
  installment_plans?: Array<{
    id: string; number: string; status: "running" | "paid_off" | "closed";
    total: number; monthly: number; months: number; next_due_on: string | null;
    left: number; late: number; late_months: number; due_now: number; months_paid: number;
  }>;
}

/** The list's filters: owes money, at or past 80% of the limit, or in credit. */
export type CustomerFilter = "owes" | "limit" | "advance" | "installments" | "late_installments";

export interface CustomerSummary {
  everyone: number;
  owed: { total: number; accounts: number };
  advance: { total: number; accounts: number };
  near_limit: number;
  installments?: number;
  late_installments?: number;
}

export interface LoyaltyLedgerEntry {
  id: string;
  type: "earn" | "redeem" | "reverse_earn" | "reverse_redeem";
  points: number;
  balance_after: number;
  note: string | null;
  created_at: string;
}

export interface CustomerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  credit_limit?: number | null;
  customer_group_id?: string | null;
}

export interface CreditPaymentInput {
  /** The form's own key — a second press is given the first answer (AnswerOnce). */
  idempotency_key?: string;
  amount: number;
  method: "cash" | "card" | "bank_transfer" | "wallet" | "other";
  reference?: string;
  note?: string;
  /** Keep what is more than is owed as an advance — asked first, never assumed. */
  allow_advance?: boolean;
}

export const customersService = {
  list: (params?: { search?: string; page?: number; standing?: CustomerFilter }) => apiGet<Customer[]>("/customers", { params }),
  summary: () => apiGet<CustomerSummary>("/customers/summary"),
  show: (id: string) => apiGet<Customer>(`/customers/${id}`),
  create: (payload: CustomerInput) => apiPost<Customer>("/customers", payload),
  update: (id: string, payload: Partial<CustomerInput>) => apiPut<Customer>(`/customers/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/customers/${id}`),
  recordPayment: (id: string, payload: CreditPaymentInput) =>
    apiPost<{ entry: LedgerEntry; credit_balance: number }>(`/customers/${id}/payments`, payload),
};
