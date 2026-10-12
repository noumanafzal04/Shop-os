import type { OrderStatus, OwnerOrder } from "./services/ordersService";

/**
 * THE ORDERS STILL BEING WORKED, as the columns of a board.
 *
 * The Orders page was one table of everything, newest first: an order that
 * had been waiting twenty minutes for somebody to accept it sat below three
 * that were already delivered. On a phone its stage, its total and its
 * next-step button were off the right-hand edge of the screen.
 *
 * A board answers the one question a shop asks of this page — "what needs me
 * now?" — left to right in the order work moves, and within a column the one
 * that has waited LONGEST is on top.
 */
export interface BoardColumn {
  key: "new" | "confirmed" | "preparing" | "leaving";
  title: string;
  /** What this column is waiting for somebody to do. */
  waitsFor: string;
  statuses: OrderStatus[];
}

export const BOARD: BoardColumn[] = [
  { key: "new", title: "New", waitsFor: "to be accepted", statuses: ["pending"] },
  { key: "confirmed", title: "Accepted", waitsFor: "for the kitchen to start", statuses: ["confirmed"] },
  { key: "preparing", title: "Being prepared", waitsFor: "to be packed", statuses: ["preparing"] },
  { key: "leaving", title: "Ready · on the way", waitsFor: "to reach the customer", statuses: ["ready", "out_for_delivery"] },
];

/** The open orders, sorted into the board's columns — longest waiting first. */
export function onTheBoard(orders: OwnerOrder[]): Record<BoardColumn["key"], OwnerOrder[]> {
  const sorted = [...orders].sort((a, b) => a.placed_at.localeCompare(b.placed_at));
  const out = { new: [], confirmed: [], preparing: [], leaving: [] } as Record<BoardColumn["key"], OwnerOrder[]>;

  for (const order of sorted) {
    const column = BOARD.find((c) => c.statuses.includes(order.status));
    if (column) out[column.key].push(order);
  }

  return out;
}

/** "2× Chicken Biryani (Full)" for each line, and how many more there are past the few shown. */
export function linesOf(order: OwnerOrder, show = 3): { lines: string[]; more: number } {
  const all = (order.items ?? []).map((i) => {
    const qty = Number(i.quantity);
    const name = i.variant_name ? `${i.product_name} (${i.variant_name})` : i.product_name;

    return `${Number.isInteger(qty) ? qty : Number(qty.toFixed(3))}× ${name}`;
  });

  return { lines: all.slice(0, show), more: Math.max(0, all.length - show) };
}

/** Where an order came from, in a word. An online order is the ordinary case and says nothing. */
export function cameBy(channel: string | null | undefined): string | null {
  switch (channel) {
    case "phone": return "Phone";
    case "whatsapp": return "WhatsApp";
    case "walk_in": return "Counter";
    case "online": return "Online";
    default: return null;
  }
}
