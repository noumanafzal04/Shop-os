import { api, apiDelete, apiGet, apiPost } from "../../../common/api/client";
import { printHtmlDocument } from "../../../common/print";

export interface DiningTable {
  id: string;
  name: string;
  /** A section of the floor — "Garden", "Rooftop". Grouping, not authority. */
  area: string | null;
  seats: number | null;
  sort_order: number;
  is_active: boolean;
  open_ticket: {
    id: string;
    ticket_number: string;
    opened_at: string;
    guest_count: number | null;
    status: string;
    /** Whose table this is. Null = nobody's, so anyone may work it. */
    waiter_id: string | null;
    waiter: { id: string; name: string } | null;
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
  /** Who is serving this table — not necessarily who opened it. */
  waiter_id: string | null;
  waiter?: { id: string; name: string } | null;
  table?: { id: string; name: string } | null;
  items: TicketItem[];
}

/** One kitchen ticket produced by a fire. A fire can produce several. */
export interface KitchenTicketRef {
  id: string;
  kot_number: number;
  station: string | null;
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
  // Split-by-quantity: settle only part of a line (e.g. 2 of 3). Takes
  // precedence over item_ids on the backend when present.
  splits?: Array<{ id: string; quantity: number }>;
  payment_method?: string;
  amount_paid?: number;
  payments?: Array<{ method: string; amount: number; reference?: string }>;
  discount?: number;
  coupon_code?: string;
  customer_name?: string;
  customer_phone?: string;
  cash_session_id?: string;
  /** Paid on top of the bill — never part of the total. */
  tip_amount?: number;
}

/** One waiter's section over a date range. */
export interface WaiterRow {
  waiter_id: string;
  waiter_name: string;
  tables: number;
  /** Guests seated. Zero means nobody recorded it, not an empty section. */
  covers: number;
  sales_count: number;
  sales_total: number;
  tips_total: number;
  open_tabs: number;
}

export interface WaiterReport {
  from: string;
  to: string;
  rows: WaiterRow[];
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

  /**
   * Send to kitchen. Returns EVERY kitchen ticket the fire produced — items are
   * routed by station, so a table ordering food and drinks makes two.
   */
  fire: (id: string, item_ids?: string[]) =>
    apiPost<KitchenTicketRef[]>(`/restaurant/tickets/${id}/fire`, { item_ids }),

  /**
   * Fetch a KOT's print-ready HTML. Behind auth like the invoice, so it goes
   * through the authenticated client rather than a plain navigation.
   */
  kotHtml: async (ticketId: string, kotId: string): Promise<string> => {
    const { data } = await api.get<string>(`/restaurant/tickets/${ticketId}/kot/${kotId}`, {
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r,
    });
    return data;
  },

  /**
   * Print every ticket a fire produced. A kitchen ticket that was never printed
   * has not been sent, whatever the screen says — so this is what "fire" means
   * in a kitchen without a display, and the failure is surfaced, never silent.
   */
  printKots: async (ticketId: string, kots: KitchenTicketRef[]): Promise<void> => {
    for (const kot of kots) {
      const html = await dineInService.kotHtml(ticketId, kot.id);
      await printHtmlDocument(html);
    }
  },

  move: (id: string, payload: { dining_table_id: string | null; guest_count?: number }) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/move`, payload),

  merge: (id: string, source_ticket_id: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/merge`, { source_ticket_id }),

  assignWaiter: (id: string, waiter_id: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/waiter`, { waiter_id }),

  openTickets: () => apiGet<Ticket[]>("/restaurant/tickets", { params: { status: "open" } }),

  /** Lay the floor out in a given order. Index in the array IS the position. */
  reorderTables: (order: string[]) => apiPost<null>("/restaurant/tables/reorder", { order }),

  /**
   * How each waiter's section did. Defaults to today.
   *
   * `covers` under-reports rather than guessing: guest count is optional when
   * a tab is opened, and a guessed cover average is worse than an honest gap.
   */
  waiterReport: (params: { from?: string; to?: string } = {}) =>
    apiGet<WaiterReport>("/restaurant/reports/waiters", { params }),

  settle: (id: string, payload: SettlePayload) =>
    apiPost<{ ticket: Ticket; sale: { id: string; invoice_number: string; total: string } }>(
      `/restaurant/tickets/${id}/settle`,
      payload,
    ),

  cancel: (id: string, reason?: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/cancel`, { reason }),
};
