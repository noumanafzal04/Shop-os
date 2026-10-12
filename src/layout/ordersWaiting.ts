import type { NavItem } from "./navItem";

/** The Orders screen's row on the rail. */
export const ORDERS_PATH = "/tenant/orders";

export interface OrdersWaiting {
  /** Placed, and accepted by nobody yet. */
  new: number;
  /** Everything not finished — the figure on the Orders page's Today tab. */
  being_worked: number;
}

/**
 * THE COUNT BESIDE "ORDERS" — and the dot that blinks.
 *
 * An order placed online arrived in a list on a screen the shop was not
 * looking at. The bell said so once; after that, nothing on any other screen
 * said an order was waiting, and a cashier at the till found out when the
 * customer rang.
 *
 * So the row says it, from every screen: how many orders are being worked
 * (steady), and — `alert` — that at least one is NEW and nobody has accepted
 * it (the count turns the colour of a notification and blinks). The blink is
 * for the new one only: a board of orders already cooking is not an alarm.
 *
 * Nothing waiting draws nothing. A row the shop does not have is left alone.
 */
export function withOrdersWaiting(items: NavItem[], waiting: OrdersWaiting | undefined): NavItem[] {
  if (!waiting || waiting.being_worked <= 0) return items;

  return items.map((item) =>
    item.path === ORDERS_PATH ? { ...item, badge: waiting.being_worked, alert: waiting.new > 0, badgeSays: saysOf(waiting) } : item,
  );
}

/** What the count means, said out loud: a bare "3" beside a word is not an announcement. */
export function saysOf(waiting: OrdersWaiting): string {
  const worked = `${waiting.being_worked} ${waiting.being_worked === 1 ? "order" : "orders"} being worked`;

  return waiting.new > 0 ? `${worked}, ${waiting.new} new` : worked;
}
