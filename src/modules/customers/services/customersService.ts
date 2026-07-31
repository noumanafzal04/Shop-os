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
  history?: {
    sales: Array<{ id: string; invoice_number: string; total: string | number; channel: string; sold_at: string }>;
    orders: Array<{ id: string; order_number: string; total: string | number; status: string; placed_at: string }>;
    total_spent: number;
    orders_count: number;
  };
  ledger?: LedgerEntry[];
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
  amount: number;
  method: "cash" | "card" | "bank_transfer" | "other";
  reference?: string;
  note?: string;
}

export const customersService = {
  list: (params?: { search?: string; page?: number }) => apiGet<Customer[]>("/customers", { params }),
  show: (id: string) => apiGet<Customer>(`/customers/${id}`),
  create: (payload: CustomerInput) => apiPost<Customer>("/customers", payload),
  update: (id: string, payload: Partial<CustomerInput>) => apiPut<Customer>(`/customers/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/customers/${id}`),
  recordPayment: (id: string, payload: CreditPaymentInput) =>
    apiPost<{ entry: LedgerEntry; credit_balance: number }>(`/customers/${id}/payments`, payload),
};
