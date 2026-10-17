/**
 * WHAT MAY BE DONE TO A SALE THAT IS ALREADY RUNG — and by whom.
 *
 * "Voiding and refunding are separated from ringing sales: they restore stock
 * and reverse money, so a cashier holding only sales.manage can no longer
 * erase a completed sale or hand cash back." That is the server's rule, and
 * the server has always kept it: three routes, two permissions.
 *
 * The panel never asked. A sale's sheet offered Return / Refund, Exchange and
 * Cancel sale to whoever could open it. A cashier pressed Cancel, chose a
 * reason from a list, pressed "Confirm cancel — restore stock", and was told
 * they had no permission; pressed Refund, chose what was coming back, and was
 * told "Return failed" with no reason at all. Nothing was lost — the server
 * refused both — but a button that leads to a refusal is a promise, and with
 * a customer standing there it is made in front of them.
 *
 *   Refund a sale           sales.refund   Return / Refund, and Exchange —
 *                                          an exchange hands goods back too
 *   Void a completed sale   sales.void     Cancel sale
 *
 * Since the owner's answer to B01 (2026-10-14) a cashier may START a return or
 * an exchange: the sheet asks for a supervisor's PIN, and the server takes it
 * only with one (SupervisorApproval). `needsApproval` says so. Since Q18
 * (2026-10-17) the same holds for a void: a cashier starts it, and somebody
 * who may void approves it with their PIN (`voidNeedsApproval`).
 */
export interface AfterTheSale {
  refunds: boolean;
  exchanges: boolean;
  voids: boolean;
  /** Return / Exchange are offered, and finish only with a supervisor's PIN. */
  needsApproval: boolean;
  /** Cancel sale is offered, and finishes only with the PIN of somebody who may void. */
  voidNeedsApproval: boolean;
}

export function afterTheSale(can: (permission: string) => boolean): AfterTheSale {
  const own = can("sales.refund");
  const refunds = own || can("sales.manage");
  const ownVoid = can("sales.void");
  const voids = ownVoid || can("sales.manage");

  return { refunds, exchanges: refunds, voids, needsApproval: refunds && !own, voidNeedsApproval: voids && !ownVoid };
}
