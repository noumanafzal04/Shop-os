import type { PaymentMethod, Sale } from "../sales/types";

/**
 * WHAT THE "SALE COMPLETE" SHEET SAYS UNDER THE TOTAL — how the bill was
 * settled, in the words of the counter.
 *
 * It said "Paid · Change" for every sale, whatever happened:
 *   B18  a khata sale read "Paid Rs 4,990 · Change Rs 0" — nothing was paid;
 *        the customer owes it;
 *   B28  a card sale with a bank offer read a total the customer did not pay,
 *        and never named the offer that paid the rest.
 */

export type SettledSale = Pick<Sale, "total" | "amount_paid" | "change_due" | "payment_method" | "payments" | "trade_in_total" | "bank_offer" | "tip_amount" | "rounding_adjustment">;

export interface SheetLine {
  label: string;
  amount: number;
}

const LEG: Partial<Record<PaymentMethod, string>> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  wallet: "Mobile wallet",
  credit: "On khata",
  deposit: "Advance paid earlier",
  other: "Other",
};

const ALONE: Partial<Record<PaymentMethod, string>> = {
  cash: "Paid in cash",
  card: "Paid by card",
  bank_transfer: "Paid by bank transfer",
  wallet: "Paid by mobile wallet",
  credit: "On khata",
  deposit: "Paid as an advance",
  other: "Paid",
};

const n = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;

/** How the server writes a tender carried from a re-rung bill (ReRingSaleAction). */
const CARRIED = "Carried from ";

export function settledLines(sale: SettledSale): SheetLine[] {
  const lines: SheetLine[] = [];

  if (sale.bank_offer && sale.bank_offer.discount > 0) {
    const named = [sale.bank_offer.bank, sale.bank_offer.label].filter(Boolean).join(" ");
    lines.push({ label: `Bank offer · ${named}`, amount: -sale.bank_offer.discount });
  }
  if (n(sale.trade_in_total) > 0) lines.push({ label: "Traded in", amount: -n(sale.trade_in_total) });
  // What stands between the total and what was paid (the full re-test): a
  // cash bill settled to a coin (#11), and the staff's tip on top (#5) —
  // "Total 116.99 · Paid by card 136.99" with nothing between read as a
  // mistake.
  if (n(sale.rounding_adjustment) !== 0) lines.push({ label: "Cash rounding", amount: n(sale.rounding_adjustment) });
  if (n(sale.tip_amount) > 0) lines.push({ label: "Staff tip", amount: n(sale.tip_amount) });

  const legs = (sale.payments ?? []).filter((p) => p.method !== "trade_in");
  // A re-rung bill (Q19 B) carries what was paid on the old one: said as
  // that, never as notes handed over now.
  const paidOn = (reference: string | null | undefined): string | null =>
    reference?.startsWith(CARRIED) ? reference.slice(CARRIED.length) : null;
  const carries = legs.some((leg) => paidOn(leg.reference) !== null);
  if ((sale.payment_method === "split" || carries) && legs.length > 0) {
    for (const leg of legs) {
      const from = paidOn(leg.reference);
      lines.push({ label: from !== null ? `Paid on ${from}` : LEG[leg.method] ?? "Other", amount: n(leg.amount) });
    }
  } else {
    lines.push({ label: ALONE[sale.payment_method] ?? "Paid", amount: n(sale.amount_paid) });
  }

  // Change is a cash question. On khata, card or a wallet there is none to
  // give, and "Change Rs 0" there reads as if notes had crossed the counter.
  const tookCash = sale.payment_method === "cash" || legs.some((l) => l.method === "cash");
  if (n(sale.change_due) > 0 || tookCash) lines.push({ label: "Change", amount: n(sale.change_due) });

  return lines;
}

/**
 * "ADD TO THIS BILL" (Q19 A, the client 2026-10-17): the customer is still at
 * the counter and wants two more. The paid bill is never changed; the next
 * sale names the FIRST bill of the visit, so a third addition hangs off the
 * same bill as the second and one receipt can name them all.
 */
export interface AddingTo {
  id: string;
  invoice_number: string;
  /** What the visit has come to so far. */
  together: number;
}

export function billToAddTo(sale: Pick<Sale, "id" | "invoice_number" | "total" | "visit">): AddingTo {
  const visit = sale.visit;

  return visit && visit.bills.length > 0
    ? { id: visit.first_id, invoice_number: visit.bills[0].invoice_number, together: visit.together }
    : { id: sale.id, invoice_number: sale.invoice_number, together: Number(sale.total) };
}

/** The sheet's line after an addition — null for a bill on its own. */
export function visitLine(sale: Pick<Sale, "id" | "visit">, money: (n: number) => string): string | null {
  const visit = sale.visit;
  if (!visit || visit.bills.length < 2) return null;

  const together = visit.bills.length === 2 ? "both bills" : `all ${visit.bills.length} bills`;

  return sale.id === visit.first_id
    ? `Bills added to this one — ${together} come to ${money(visit.together)}`
    : `Added to ${visit.bills[0].invoice_number} — ${together} come to ${money(visit.together)}`;
}
