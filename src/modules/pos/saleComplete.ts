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

export type SettledSale = Pick<Sale, "total" | "amount_paid" | "change_due" | "payment_method" | "payments" | "trade_in_total" | "bank_offer">;

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

export function settledLines(sale: SettledSale): SheetLine[] {
  const lines: SheetLine[] = [];

  if (sale.bank_offer && sale.bank_offer.discount > 0) {
    const named = [sale.bank_offer.bank, sale.bank_offer.label].filter(Boolean).join(" ");
    lines.push({ label: `Bank offer · ${named}`, amount: -sale.bank_offer.discount });
  }
  if (n(sale.trade_in_total) > 0) lines.push({ label: "Traded in", amount: -n(sale.trade_in_total) });

  const legs = (sale.payments ?? []).filter((p) => p.method !== "trade_in");
  if (sale.payment_method === "split" && legs.length > 0) {
    for (const leg of legs) lines.push({ label: LEG[leg.method] ?? "Other", amount: n(leg.amount) });
  } else {
    lines.push({ label: ALONE[sale.payment_method] ?? "Paid", amount: n(sale.amount_paid) });
  }

  // Change is a cash question. On khata, card or a wallet there is none to
  // give, and "Change Rs 0" there reads as if notes had crossed the counter.
  const tookCash = sale.payment_method === "cash" || legs.some((l) => l.method === "cash");
  if (n(sale.change_due) > 0 || tookCash) lines.push({ label: "Change", amount: n(sale.change_due) });

  return lines;
}
