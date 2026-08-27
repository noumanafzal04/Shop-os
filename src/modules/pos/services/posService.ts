import { apiDelete, apiGet, apiPost } from "../../../common/api/client";
import type { Product } from "../../catalog/types";

export interface CashSession {
  id: string;
  status: "open" | "closed";
  opening_float: string | number;
  cash_sales: string | number;
  expected_cash: string | number | null;
  counted_cash: string | number | null;
  variance: string | number | null;
  sales_count: number;
  sales_total: string | number;
  opened_at: string;
  closed_at: string | null;
  register_id?: string | null;
  register?: { id: string; name: string; code: string | null } | null;
  /**
   * A practice shift. Fixed at open — nothing rung on it reaches stock, the
   * day's takings or any report, and its receipts print TRAINING.
   */
  is_training?: boolean;
  /** Somebody is standing in for me right now. */
  covered_by?: { user_id: string; user_name: string | null; started_at: string } | null;
}

/**
 * What a reliever holds: someone else's open drawer, while its cashier is on
 * a break.
 *
 * This is deliberately NOT a CashSession. A cover grants the right to sell,
 * never the right to reconcile — so the server hands back the shift id (needed
 * on every sale), whose drawer it is, and nothing else. There is no
 * `opening_float` or `expected_cash` here because the reliever is not the one
 * being measured against them.
 */
export interface ActiveCover {
  id: string;
  covering: true;
  session_id: string;
  cashier_name: string | null;
  register: { id: string; name: string; code: string | null } | null;
  /**
   * Whether the drawer I am standing at is a practice one. The float and the
   * expected cash are withheld from a reliever on purpose; this is not — ring
   * a real customer onto a training shift and you take money for a sale that
   * was never recorded.
   */
  is_training?: boolean;
  started_at: string;
  ended_at: string | null;
  reason: string | null;
  /** What I have rung while standing here — mine, not the drawer's. */
  mine: { sales_count: number; sales_total: number; cash_taken: number };
}

/** One stretch where somebody else rang on a drawer. */
export interface CoverRecord {
  id: string;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  ended_by_name: string | null;
  reason: string | null;
  open: boolean;
  sales_count: number;
  sales_total: number;
  cash_taken: number;
}

/** `/pos/session` answers with my own drawer, a cover, or nothing at all. */
export type SessionState = CashSession | ActiveCover | null;

export const isCover = (s: SessionState): s is ActiveCover =>
  s !== null && (s as ActiveCover).covering === true;

/**
 * The drawer a sale rung here must be recorded against — mine, or the one I am
 * covering. Null means this till may not ring at all.
 *
 * The distinction `open`/`covering` cannot answer this on its own, and asking
 * it wrongly costs the whole feature in one direction or the other:
 *
 *   "do I have a drawer of my own?"  → a reliever cannot ring. Relief cover
 *                                      exists SO the reliever rings.
 *   "is there a drawer to ring into?" → correct, and still leaves reconcile
 *                                      actions asking the first question,
 *                                      because a cover may sell and must never
 *                                      count the drawer.
 *
 * The till asked the first one for as long as relief cover has existed: a
 * reliever saw "Open a shift to sell." with Tender greyed out, while the sale
 * payload was already built to carry the covered session's id.
 */
export const ringableSessionId = (s: SessionState): string | null =>
  s === null ? null : isCover(s) ? s.session_id : s.status === "open" ? s.id : null;

/**
 * May this till ring a sale right now?
 *
 * ── The rule the shop was given, and the one the till applied ───────────
 *
 * "Require open shift" is a shop setting. Its own words on the Settings
 * screen are "Refuses a counter sale unless the cashier has a drawer open",
 * and it ships OFF — deliberately. The backend test that pins the default says
 * why in one line: *"Shift discipline is opt-in: enforcing it by default would
 * stop a one-person shop from selling the day the check went live."*
 *
 * The server honours it exactly that way — `cash_session_id` is `nullable`,
 * and SaleController refuses a shiftless counter sale only when the setting is
 * on.
 *
 * The till never read the setting at all. It asked `activeSessionId !== null`
 * and nothing else, so shift discipline was **always on at the counter** no
 * matter what the shop had chosen. Turning the switch off changed nothing a
 * cashier could observe, and a one-person shop that had never opened a drawer
 * could not ring a single sale — the precise outcome the default exists to
 * prevent.
 *
 * A drawer to ring into always wins. The setting only decides what happens
 * when there is none.
 */
export function canRingASale(session: SessionState, requireShift: boolean): boolean {
  if (ringableSessionId(session) !== null) return true;

  return !requireShift;
}

/**
 * Why the till will not ring, in the shop's own terms — or null when it will.
 *
 * Kept beside the rule rather than in the page, because the message and the
 * gate disagreeing is its own bug: "Open a shift to sell." was printed under a
 * disabled Tender button on shops that had never asked for shifts.
 */
export function whyCannotRing(session: SessionState, requireShift: boolean): string | null {
  if (canRingASale(session, requireShift)) return null;

  return "Open a shift to sell — this shop requires one.";
}

/**
 * Is this till practising?
 *
 * The flag belongs to the DRAWER, not the person standing at it — so a
 * reliever covering a training shift is training too. Both shapes carry it for
 * that reason, and reading it off whichever one arrived is the whole rule.
 *
 * Defaults to false when absent: a server that has not been told about
 * training must not leave a real till wearing the banner.
 */
export const isTraining = (s: SessionState): boolean =>
  s !== null && (s as { is_training?: boolean }).is_training === true;

export interface HeldSale {
  id: string;
  label: string | null;
  total_estimate: string | number;
  // The full ticket state so resume restores EXACTLY what was parked —
  // dine-in table, customer contact, tax, and applied coupon included.
  cart: {
    items: HeldCartLine[];
    customer_name?: string;
    customer_phone?: string;
    discount?: number;
    tax?: string;
    order_type?: "takeaway" | "dine_in";
    table_no?: string;
    coupon_code?: string | null;
    payment_method?: "cash" | "card";
  };
  created_at: string;
  register_id?: string | null;
  user?: { id: string; name: string } | null;
  register?: { id: string; name: string; code: string | null } | null;
}

export interface HeldCartLine {
  product_id: string;
  variant_id?: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  // Pack-breaking: which pack this parked line was in (restored on resume).
  product_unit_id?: string | null;
  unit_name?: string | null;
  unit_factor?: number;
  discountValue?: number;
  discountMode?: "amt" | "pct";
  modifier_option_ids?: string[];
  modifiers_label?: string;
}

/** The movement types a cashier may record from the till. */
export type ManualMovementType = "paid_in" | "paid_out" | "drop" | "float_add" | "no_sale";

/**
 * Every movement type the drawer can show. The system ones are written by the
 * flow that actually moved the money (a khata settled, a supplier paid from the
 * till, a voided cash sale handed back) — the POS renders them but never posts
 * them.
 */
export type CashMovementType =
  | ManualMovementType
  | "khata_in"
  | "supplier_out"
  | "expense_out"
  | "void_refund";

export interface CashMovement {
  id: string;
  type: CashMovementType;
  // The server's own reading of which way the drawer moved — "none" is a
  // no-sale, an event with no amount.
  direction: "in" | "out" | "none";
  amount: string | number;
  reason: string | null;
  note: string | null;
  user?: { id: string; name: string } | null;
  created_at: string | null;
}

/**
 * The X-read totals (App\Support\DrawerMath) — the ONE place the server decides
 * what a drawer should hold, so the mid-shift read and the close-and-count can
 * never disagree. The chain the UI renders:
 *
 *   cash_sales    = cash_tendered − change_given − cash_refunds
 *   expected_cash = opening_float + cash_sales + cash_in − cash_out
 */
export interface DrawerTotals {
  cash_tendered: number;
  change_given: number;
  cash_refunds: number;
  cash_in: number;
  cash_out: number;
  cash_sales: number;
  expected_cash: number;
  sales_count: number;
  sales_total: number;
  discounts: number;
  tax: number;
  voids: number;
  refunds: number;
  /** Keyed by tender method: cash, card, bank_transfer, credit… */
  tender_mix: Record<string, number>;
}

export interface SessionReport {
  session: CashSession;
  /**
   * Under blind close `expected_cash` and `cash_sales` are ABSENT, not zero —
   * the cashier is not shown the number they are about to be measured
   * against. Everything they actually did stays visible.
   */
  drawer: Omit<DrawerTotals, "expected_cash" | "cash_sales"> & {
    expected_cash?: number;
    cash_sales?: number;
  };
  blind_close: boolean;
  denomination_count: boolean;
  declare_tenders: boolean;
  /** Notes and coins to offer, largest first. */
  denominations: number[];
  /** Who else rang on this drawer, and what they took. */
  covers: CoverRecord[];
  movements: CashMovement[];
}

export const posService = {
  lookup: (code: string) =>
    apiGet<{
      product: Product;
      variant_id: string | null;
      product_unit_id?: string | null;
      requires_prescription: boolean;
      near_expiry: { batch_number: string; expiry_date: string; days: number } | null;
      /**
       * A lot that has AGED past the shop's threshold — a tyre's sidewall week,
       * not an expiry. Permanently null for anything the shop dates by expiry,
       * and `near_expiry` is permanently null for a tyre; the counter needs
       * whichever of the two its stock actually has.
       */
      aged: { batch_number: string; age: string; status: string } | null;
      // Present only when the scanned code was a scale (embedded-weight)
      // barcode: the pre-filled weighed quantity to add.
      scale?: {
        mode: "weight" | "price";
        quantity: number;
        weight: number | null;
        embedded_price: number | null;
      };
    }>("/pos/lookup", { params: { code } }),

  /**
   * The counter's own shortlist — what this branch actually sells, with
   * un-scannable items first. Derived on the server; nobody maintains it, and
   * a shop with no trade yet gets an empty list and no strip.
   */
  quickKeys: () => apiGet<Product[]>("/pos/quick-keys"),

  /**
   * Who this till may credit a sale to. Empty unless the shop has switched on
   * "ask who served the customer".
   *
   * Rides the POS prefix, not `/staff`: a cashier holds `sales.manage` and not
   * `staff.manage`, and naming a colleague as the seller must not need the
   * permission that edits people.
   */
  sellers: () => apiGet<Array<{ id: string; name: string }>>("/pos/sellers"),

  // Answers with my own drawer, the one I'm covering, or null. Narrow it with
  // `isCover()` before reading any figure off it.
  currentSession: () => apiGet<SessionState>("/pos/session"),

  /**
   * Hold the lane while its cashier is away. The drawer stays theirs — this
   * only puts my name on the sales I ring in the meantime.
   */
  startCover: (payload: { session_id?: string; reason?: string } = {}) =>
    apiPost<ActiveCover>("/pos/session/cover", payload),

  /** Hand it back. The cashier unlocking with their own PIN also does this. */
  endCover: () => apiPost<ActiveCover>("/pos/session/cover/end", {}),
  // The lane may be named explicitly (the picker) or left to the terminal's
  // own X-Register-Id header. Re-opening the lane you already hold RESUMES it.
  openSession: (opening_float: number, register_id?: string | null, is_training = false) =>
    apiPost<CashSession>("/pos/session/open", {
      opening_float,
      ...(register_id ? { register_id } : {}),
      ...(is_training ? { is_training: true } : {}),
    }),
  // Handover: carry an open drawer to another lane when a terminal dies or the
  // shop closes the far lanes for the evening.
  moveSession: (register_id: string) => apiPost<CashSession>("/pos/session/move", { register_id }),
  closeSession: (payload: {
    counted_cash: number;
    notes?: string;
    /** {5000: 3, 1000: 12, …}. When present it DERIVES the total server-side. */
    denominations?: Record<string, number>;
    /** What the cashier says each non-cash tender took. */
    declared_tenders?: Record<string, number>;
  }) => apiPost<CashSession>("/pos/session/close", payload),

  // The live X-read. 409 SHIFT_NOT_OPEN when the caller holds no drawer, so
  // only ask once a shift is known to be open.
  sessionReport: () => apiGet<SessionReport>("/pos/session/report"),
  movements: () => apiGet<CashMovement[]>("/pos/session/movements"),
  // Cashier-initiated only; the server resolves the drawer from the caller, so
  // a movement can never be posted into someone else's till.
  recordMovement: (payload: { type: ManualMovementType; amount?: number; reason?: string; note?: string }) =>
    apiPost<CashMovement>("/pos/session/movements", payload),

  heldList: () => apiGet<HeldSale[]>("/pos/held"),
  hold: (payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number }) =>
    apiPost<HeldSale>("/pos/held", payload),
  // CLAIM, not load-then-delete: exactly one lane may resume a parked ticket,
  // or two cashiers ring the same basket and the shop ships it twice.
  claimHeld: (id: string) => apiPost<HeldSale>(`/pos/held/${id}/claim`),
  deleteHeld: (id: string) => apiDelete<null>(`/pos/held/${id}`),
};
