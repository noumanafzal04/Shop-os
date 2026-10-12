import { dineInService, type KitchenTicketRef } from "../dinein/services/dineInService";

/**
 * THE KITCHEN'S SLIP FOR AN ORDER — printed by the screen that sent it.
 *
 * A table's order prints its slip when it is fired, and a counter sale when it
 * is paid. An order from the Orders queue reached the kitchen's SCREEN (once it
 * reached the kitchen at all) and no paper: half of "sent to the kitchen", in a
 * kitchen that works off a spike.
 *
 * The server says which ticket the step sent (`kitchen_ticket`, on the answer
 * to taking an order or moving it on); a browser prints, so the printing is
 * here. `kot_auto_print` is the shop's own answer to "screen or paper" — the
 * same switch the table and the counter obey.
 */
export interface SentToTheKitchen {
  ticket_id: string;
  ticket_number: string;
  kots: KitchenTicketRef[];
}

export type SlipOutcome = "nothing sent" | "on the screen" | "printed" | "did not print";

export async function printTheSlip(sent: SentToTheKitchen | null | undefined, printsOnPaper: boolean): Promise<SlipOutcome> {
  if (!sent || sent.kots.length === 0) return "nothing sent";
  if (!printsOnPaper) return "on the screen";

  try {
    await dineInService.printKots(sent.ticket_id, sent.kots);

    return "printed";
  } catch {
    // The order is on the kitchen's screen either way; the caller says so.
    return "did not print";
  }
}

/** What to tell whoever pressed the button. */
export function slipSays(outcome: SlipOutcome, orderNumber: string): string | null {
  switch (outcome) {
    case "printed": return `${orderNumber} is with the kitchen — its slip has been sent to the printer.`;
    case "on the screen": return `${orderNumber} is on the kitchen's screen.`;
    case "did not print": return `${orderNumber} is on the kitchen's screen, but its slip did not print.`;
    default: return null;
  }
}
