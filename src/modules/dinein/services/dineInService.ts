import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

export interface DiningTable {
  id: string;
  name: string;
  seats: number | null;
  sort_order: number;
  is_active: boolean;
  open_ticket: {
    id: string;
    ticket_number: string;
    opened_at: string;
    guest_count: number | null;
    status: string;
  } | null;
}

export interface TicketItem {
  id: string;
  product_id: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: string;
  unit_price: string;
  line_total: string;
  modifiers: Array<{ name: string; price?: number }> | null;
  note: string | null;
  kot_status: "pending" | "fired" | "served" | "void" | string;
  voided_at: string | null;
  sale_id: string | null;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  order_type: "dine_in" | "takeaway";
  status: "open" | "closed" | "void" | string;
  guest_count: number | null;
  opened_at: string;
  running_total: number;
  table?: { id: string; name: string } | null;
  items: TicketItem[];
}

export interface AddItemLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  modifier_option_ids?: string[];
  note?: string;
}

export interface SettlePayload {
  item_ids?: string[];
  payment_method?: string;
  amount_paid?: number;
  payments?: Array<{ method: string; amount: number; reference?: string }>;
  discount?: number;
  coupon_code?: string;
  customer_name?: string;
  customer_phone?: string;
  cash_session_id?: string;
}

export const dineInService = {
  tables: () => apiGet<DiningTable[]>("/restaurant/tables", { params: { active_only: true } }),

  createTable: (payload: { name: string; seats?: number; area?: string }) =>
    apiPost<DiningTable>("/restaurant/tables", payload),
  deleteTable: (tableId: string) => apiDelete<null>(`/restaurant/tables/${tableId}`),

  openTicket: (payload: {
    order_type?: "dine_in" | "takeaway";
    dining_table_id?: string | null;
    guest_count?: number;
    customer_name?: string;
    customer_phone?: string;
  }) => apiPost<Ticket>("/restaurant/tickets", payload),

  ticket: (id: string) => apiGet<Ticket>(`/restaurant/tickets/${id}`),

  addItems: (id: string, items: AddItemLine[]) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/items`, { items }),

  voidItem: (id: string, itemId: string, reason?: string) =>
    apiDelete<Ticket>(`/restaurant/tickets/${id}/items/${itemId}`, { data: { reason } }),

  fire: (id: string, item_ids?: string[]) =>
    apiPost<{ kot_number: number }>(`/restaurant/tickets/${id}/fire`, { item_ids }),

  settle: (id: string, payload: SettlePayload) =>
    apiPost<{ ticket: Ticket; sale: { id: string; invoice_number: string; total: string } }>(
      `/restaurant/tickets/${id}/settle`,
      payload,
    ),

  cancel: (id: string, reason?: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/cancel`, { reason }),
};
