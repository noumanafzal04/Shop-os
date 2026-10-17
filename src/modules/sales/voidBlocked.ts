import type { SaleVoid } from "./types";

/**
 * WHAT STANDS BETWEEN THIS SALE AND "CONFIRM CANCEL" — said before the press.
 *
 * The server refuses a void whose day is over (Q18), and one whose notes
 * would leave no drawer or a drawer that does not hold them (B86). The sheet
 * says the same thing first, from the same answer (`sale.void`), so the
 * button is never a promise the server then breaks in front of a customer.
 *
 * Null when nothing does. `otherDrawer` is a drawer named on the sheet: the
 * server checks that one, and this does not know what it holds.
 */
export function voidBlocked(v: SaleVoid, otherDrawer: boolean, money: (n: number) => string): string | null {
  if (!v.open) return v.why_not ?? "This sale's day is over — take the goods back with Return / Refund.";
  if (!v.from_drawer || otherDrawer) return null;

  const cash = money(v.cash_back);
  if (v.drawer === "practice") return `This hands back ${cash} in cash, and your open shift is a practice one. Hand it back from a real drawer.`;
  if (v.drawer !== "open") return `This hands back ${cash} in cash. Open your shift first, or choose the drawer it comes out of.`;
  if (v.drawer_holds !== null && v.cash_back > v.drawer_holds + 0.001) {
    return `Your drawer holds ${money(v.drawer_holds)} — this hands back ${cash} in cash. Put cash in the drawer first.`;
  }

  return null;
}
