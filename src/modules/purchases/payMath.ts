/**
 * WHAT IS LEFT AFTER THIS PAYMENT.
 *
 * The Pay dialog used to show one number — the outstanding balance — and then
 * take an amount without ever saying what the amount would leave behind. A
 * shopkeeper handing over Rs 15,000 against Rs 36,000 wants to see Rs 21,000
 * before they press the button, not after.
 *
 * Kept out of the component so the arithmetic can be tested on its own, and so
 * the dialog and anything that later shows the same line cannot drift apart.
 */

/** Rupee-level tolerance. Below this, a difference is rounding, not money. */
const EPSILON = 0.001;

export type PayKind = "still-owed" | "settles" | "advance";

export interface PayOutlook {
  /** What is still owed after this payment (0 when it settles or overshoots). */
  remaining: number;
  /** Money paid beyond what was owed — the shop is owed it back in goods. */
  advance: number;
  kind: PayKind;
}

/**
 * @param due     what the payment is being applied to — one order's balance,
 *                or the whole account.
 * @param amount  what is being paid.
 */
export function payOutlook(due: number, amount: number): PayOutlook {
  const after = round(due - amount);

  if (after > EPSILON) return { remaining: after, advance: 0, kind: "still-owed" };
  if (after < -EPSILON) return { remaining: 0, advance: round(-after), kind: "advance" };

  return { remaining: 0, advance: 0, kind: "settles" };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * WHAT ONE ORDER STILL OWES: what arrived, less what was paid on it.
 *
 * The Pay dialog said `total − paid`, so an order half-delivered showed the
 * whole order as due ("PO-000002 · Rs 34,000 due" when Rs 20,500 had come).
 * The server bills on delivery (Payable::AMOUNT); this says the same.
 */
/**
 * Was this person sent the money at all? The server leaves an order's total
 * and a supplier's balance out for whoever only takes deliveries in (the
 * owner, 2026-10-14) — so a column of them is drawn only when they arrived,
 * never as "Settled" or a blank figure.
 */
export const sentMoney = <T,>(rows: T[], key: keyof T): boolean => rows.some((r) => r[key] !== undefined);

export function dueOn(po: { received_total?: string | number; total?: string | number; amount_paid?: string | number }): number {
  return round(Number(po.received_total ?? 0) - Number(po.amount_paid ?? 0));
}

/**
 * The orders a payment can go against — the server's `openOrdersFor`: placed,
 * and owing for something that arrived. A cancelled order still owes for what
 * came before it was cancelled.
 */
export function openOrders<T extends { status: string; received_total?: string | number; total?: string | number; amount_paid?: string | number }>(orders: T[]): T[] {
  return orders.filter((po) => po.status !== "draft" && dueOn(po) > EPSILON);
}

/** How a supplier was paid, in the shop's words. */
export const PAY_METHODS: Array<{ value: string; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "wallet", label: "Mobile wallet" },
  { value: "cheque", label: "Cheque" },
];

export const payMethodLabel = (method: string): string => PAY_METHODS.find((m) => m.value === method)?.label ?? method;

interface PaidOn {
  amount_paid?: string | number;
  allocations?: Array<{ id: string; amount: string | number; payment: { id: string; amount: string | number; method: string; reference: string | null; paid_at: string } }>;
  payments?: Array<{ id: string; amount: string | number; method: string; reference: string | null; paid_at: string }>;
}

export interface PaymentLine {
  key: string;
  paidAt: string;
  method: string;
  reference: string | null;
  /** What of it went to this order. */
  amount: number;
  /** The whole payment, when it also paid other orders. */
  whole: number;
}

/**
 * EVERY PAYMENT ON THIS ORDER, OLDEST FIRST: each share a payment says it paid
 * (`allocations`, from 2026-10-15), and before that every payment that named
 * this order alone — those were applied to it whole.
 */
export function paymentLines(po: PaidOn): PaymentLine[] {
  const shared = (po.allocations ?? []).map((a) => ({
    key: a.id, paidAt: a.payment.paid_at, method: a.payment.method, reference: a.payment.reference,
    amount: Number(a.amount), whole: Number(a.payment.amount),
  }));
  const said = new Set((po.allocations ?? []).map((a) => a.payment.id));
  const named = (po.payments ?? []).filter((p) => !said.has(p.id)).map((p) => ({
    key: p.id, paidAt: p.paid_at, method: p.method, reference: p.reference, amount: Number(p.amount), whole: Number(p.amount),
  }));

  return [...shared, ...named].sort((a, b) => a.paidAt.localeCompare(b.paidAt));
}

/**
 * WHAT AN ORDER SHOWS AS PAID THAT NO PAYMENT IN ITS HISTORY ACCOUNTS FOR.
 *
 * A payment on account made before payments said which orders they paid
 * raised the order's paid figure and left no trace on it. Said as its own
 * line, so the history still adds up to what the order shows as paid.
 */
export function paidBeforeHistory(po: PaidOn): number {
  const listed = paymentLines(po).reduce((sum, l) => sum + l.amount, 0);

  return Math.max(0, round(Number(po.amount_paid ?? 0) - listed));
}
