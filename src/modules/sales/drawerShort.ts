import type { ReturnWorth } from "./types";

/**
 * MORE CASH THAN THE DRAWER HOLDS — what the refund sheet says before the press.
 *
 * A refund of 3,509.99 went out of a drawer opened with 2,000: no word on
 * the sheet, and the till then expected −1,509.99 while it refused a pay-out
 * of 500 for being more than the drawer held (money pass 2026-10-16, $6).
 * The server now refuses both the same way; this is the sheet saying so first.
 *
 * Returns what the drawer holds when the cash going back is more than that,
 * else null. Only for cash out of the person's OWN drawer: another drawer,
 * named under the supervisor's PIN, is the server's to check.
 */
export function drawerShort(worth: ReturnWorth | null, otherDrawerNamed: boolean): number | null {
  if (worth === null || otherDrawerNamed || worth.back_by !== "cash" || worth.drawer_holds == null) return null;
  const cashBack = worth.handed_back ?? worth.refund_total;

  return cashBack > worth.drawer_holds + 0.001 ? worth.drawer_holds : null;
}
