import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";

/**
 * THE ONE THING TO KNOW, in a sentence.
 *
 * The dashboard opened on a greeting and a date — two things the person
 * looking at it already knows. What they came to find out is whether anything
 * needs them, and that was eight panels down, in a list.
 *
 * So the head of the page says it, in one line, and the line is the most
 * pressing thing that is TRUE right now. Every sentence here is read off a
 * figure the server sent; none of it is mood. "Everything is moving" is only
 * said when something has actually moved.
 *
 * The order is the order of urgency — and it is the same order the floor's
 * own tiles use: food going cold outranks an order nobody has looked at,
 * which outranks a shelf that is merely getting low.
 */
export type StatusTone = "alert" | "busy" | "calm";

export interface ShopStatus {
  tone: StatusTone;
  text: string;
}

const n = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export function shopStatus(data: TenantDashboard, caps: Capabilities): ShopStatus {
  const floor = data.floor;

  // Cooked, and nobody has carried it.
  if (floor && floor.kot_ready > 0) {
    return {
      tone: "alert",
      text: `${n(floor.kot_ready, "order is", "orders are")} ready on the pass, waiting to be carried.`,
    };
  }

  // A customer has asked for something and nobody has answered.
  if (caps.takesOrders && data.pending_orders > 0) {
    return {
      tone: "alert",
      text: `${n(data.pending_orders, "order is", "orders are")} waiting for you to accept.`,
    };
  }

  // A day left open is tomorrow's banking landing on today's — say it early.
  if (data.till && data.till.unclosed_days > 0) {
    return {
      tone: "alert",
      text: `${n(data.till.unclosed_days, "earlier day is", "earlier days are")} still open and not closed off.`,
    };
  }

  if (floor && floor.kot_waiting > 0) {
    return {
      tone: "busy",
      text: `The kitchen is cooking ${n(floor.kot_waiting, "ticket", "tickets")} — ${floor.occupied} of ${floor.tables} tables sat.`,
    };
  }

  if (floor && floor.occupied > 0) {
    return { tone: "busy", text: `${floor.occupied} of ${floor.tables} tables are sat, and nothing is waiting on the kitchen.` };
  }

  if (caps.tracksStock && data.inventory.out_of_stock > 0) {
    return {
      tone: "busy",
      text: `${n(data.inventory.out_of_stock, "item has", "items have")} run out — worth a look before the next customer asks.`,
    };
  }

  if (caps.tracksStock && data.low_stock_count > 0) {
    return { tone: "busy", text: `${n(data.low_stock_count, "item is", "items are")} running low.` };
  }

  if (caps.sells && data.today.sales_count > 0) {
    return {
      tone: "calm",
      text: `Everything is moving — ${n(data.today.sales_count, "sale", "sales")} so far today, and nothing needs you.`,
    };
  }

  // Said plainly. A shop that has sold nothing yet is not "moving smoothly".
  return { tone: "calm", text: caps.sells ? "Nothing rung up yet today, and nothing needs you." : "Nothing needs you right now." };
}
