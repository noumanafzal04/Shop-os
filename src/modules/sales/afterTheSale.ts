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
 */
export interface AfterTheSale {
  refunds: boolean;
  exchanges: boolean;
  voids: boolean;
}

export function afterTheSale(can: (permission: string) => boolean): AfterTheSale {
  const refunds = can("sales.refund");

  return { refunds, exchanges: refunds, voids: can("sales.void") };
}
