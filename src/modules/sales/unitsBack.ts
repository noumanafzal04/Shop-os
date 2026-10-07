/**
 * WHICH UNIT CAME BACK.
 *
 * A phone is sold by its number, and the server has always been able to take
 * one back by it: name the number and that unit is on the shelf again, and
 * the warranty is off the customer who no longer has it.
 *
 * No screen ever named one. The returns sheet asked "how many?" and sent a
 * quantity — so a refunded phone stayed "sold" under its number, was refused
 * at the till as already sold while standing on the shelf, and the warranty
 * desk went on reading "Under warranty" beside the name of somebody who had
 * been given their money back.
 *
 * This is the same rule the server applies (`unitsComingBack` in
 * ProcessSaleReturnAction), asked here first so the sheet can say what it
 * needs before the press instead of being refused after it.
 */

export interface SoldUnit {
  id: string;
  sale_item_id?: string | null;
  serial: string;
  returned_at?: string | null;
}

/** The numbered units of one line that are still out with the customer. */
export function unitsOut(serials: SoldUnit[] | undefined, saleItemId: string): SoldUnit[] {
  return (serials ?? []).filter((u) => u.sale_item_id === saleItemId && !u.returned_at);
}

export interface WhichUnits {
  /**
   * `none`  — nothing on this line has a number still out: nothing to say.
   * `all`   — everything left on the line is coming back: nothing to choose.
   * `pick`  — some of them are, and the shop has to say which.
   */
  mode: "none" | "all" | "pick";
  /** In `pick`: how many numbers must be ticked, at least and at most. */
  atLeast: number;
  atMost: number;
}

/**
 * What a return of `quantity` units has to say about which units they are.
 *
 * @param out        numbered units of the line still out
 * @param remaining  units of the line still returnable (numbered or not)
 * @param quantity   how many are coming back now
 */
export function whichUnits(out: number, remaining: number, quantity: number): WhichUnits {
  const units = Math.round(quantity);
  if (out <= 0 || units <= 0) return { mode: "none", atLeast: 0, atMost: 0 };
  if (units >= Math.round(remaining)) return { mode: "all", atLeast: 0, atMost: 0 };

  // Units that left with no number and are still out: any of these can be
  // what came back, and there is nothing to tick for them.
  const unnumbered = Math.max(0, Math.round(remaining) - out);

  return { mode: "pick", atLeast: Math.max(0, units - unnumbered), atMost: Math.min(units, out) };
}

/** Has the cashier said enough about which units are coming back? */
export function saidWhich(which: WhichUnits, ticked: number): boolean {
  return which.mode !== "pick" || (ticked >= which.atLeast && ticked <= which.atMost);
}

/** What to send for one returned line: the numbers ticked, or nothing where there is nothing to say. */
export function numbersToSend(which: WhichUnits, ticked: string[]): string[] | undefined {
  return which.mode === "pick" ? ticked : undefined;
}
