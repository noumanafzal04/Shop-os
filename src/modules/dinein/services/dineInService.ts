import { api, apiDelete, apiGet, apiPatch, apiPost } from "../../../common/api/client";
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

/**
 * An open tab, as the floor sees it. Mirrors `TabSummary::of()`.
 *
 * Deliberately NOT a `Ticket`: no lines. The floor is polled every few seconds
 * and draws a tile per tab; it is told what each tab has REACHED, never what
 * is on it.
 */
export interface FloorTab {
  id: string;
  ticket_number: string;
  order_type: "dine_in" | "takeaway";
  status: string;
  opened_at: string | null;
  guest_count: number | null;
  customer_name: string | null;
  /** Whose table this is. Null = nobody's, so anyone may work it. */
  waiter_id: string | null;
  waiter: { id: string; name: string } | null;
  /** What is still to be collected — not the tab's whole value once part is paid. */
  to_pay: number;
  lines: number;
  /** Ordered and not yet sent to the kitchen. */
  unsent: number;
  /** Dockets on the pass, waiting to be carried. */
  ready: number;
  cooking: number;
  /** Something on it is paid for: it can be settled, not cancelled. */
  part_paid: boolean;
  /** Opened in a service that is over. */
  from_earlier: boolean;
}

export interface FloorTable {
  id: string;
  name: string;
  area: string | null;
  seats: number | null;
  sort_order: number;
  is_active: boolean;
  open_ticket: FloorTab | null;
}

/** The floor screen's one payload. */
export interface Floor {
  tables: FloorTable[];
  /** Open tabs with no table to stand for them. Counter orders are not here: they are paid. */
  takeaway: FloorTab[];
  service_began: string;
  server_time: string;
}

export interface TicketItem {
  id: string;
  product_id: string | null;
  /** The size that was ordered, when the dish comes in sizes. */
  variant_id?: string | null;
  /** The extras chosen — what makes two lines of one dish the same order or not. */
  modifier_option_ids?: string[] | null;
  product_name: string;
  variant_name: string | null;
  quantity: string;
  unit_price: string;
  line_total: string;
  modifiers: Array<{ name: string; price?: number }> | null;
  note: string | null;
  /** `cleared` = taken off the kitchen board in a clear-down, never claimed as served. */
  kot_status: "pending" | "fired" | "served" | "cleared" | "void" | string;
  voided_at: string | null;
  sale_id: string | null;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  order_type: "dine_in" | "takeaway";
  status: "open" | "closed" | "void" | string;
  guest_count: number | null;
  /** A takeaway's name — what the kitchen calls it by. */
  customer_name?: string | null;
  opened_at: string;
  running_total: number;
  /** Who is serving this table — not necessarily who opened it. */
  waiter_id: string | null;
  waiter?: { id: string; name: string } | null;
  table?: { id: string; name: string } | null;
  items?: TicketItem[];
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

  /** Tables with what each tab has reached, and the takeaway tabs beside them. */
  floor: () => apiGet<Floor>("/restaurant/floor"),

  /**
   * Close every tab an earlier service left open, in one go. Tabs with a
   * payment on them are kept — `kept` says how many — because the rest of
   * that bill is somebody's to settle, not to sweep.
   */
  closeOlderTabs: () => apiPost<{ closed: number; kept: number }>("/restaurant/floor/close-older", {}),

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

  /**
   * More, fewer, or a note — on a line the kitchen has not been sent yet.
   *
   * `adjust` is a STEP (+1, −1), never a target. Four quick taps are four
   * requests that each say "one more" and all arrive at four; four that each
   * said "make it N" from what the screen last saw would arrive at two.
   * Stepping a line to nothing takes it off the tab.
   */
  updateItem: (id: string, itemId: string, change: { adjust?: number; note?: string | null }) =>
    apiPatch<Ticket>(`/restaurant/tickets/${id}/items/${itemId}`, change),

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

  /**
   * "Bill please": what the table owes, as print-ready HTML — before it pays.
   *
   * The server works the figures out the way the sale will, so the paper
   * says what the till is about to ask for; the tab screen's own total is an
   * estimate of the tax. Behind auth like the kitchen ticket.
   */
  billHtml: async (ticketId: string): Promise<string> => {
    const { data } = await api.get<string>(`/restaurant/tickets/${ticketId}/bill`, {
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r,
    });
    return data;
  },

  printBill: async (ticketId: string): Promise<void> => {
    await printHtmlDocument(await dineInService.billHtml(ticketId));
  },

  move: (id: string, payload: { dining_table_id: string | null; guest_count?: number }) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/move`, payload),

  merge: (id: string, source_ticket_id: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/merge`, { source_ticket_id }),

  assignWaiter: (id: string, waiter_id: string) =>
    apiPost<Ticket>(`/restaurant/tickets/${id}/waiter`, { waiter_id }),

  /** Colleagues a table may be handed to — id and name, nothing else. */
  servers: () => apiGet<Array<{ id: string; name: string }>>("/restaurant/servers"),

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
