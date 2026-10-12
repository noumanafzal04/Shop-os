import type { OrderStatus, OwnerOrder, Rider } from "./services/ordersService";

/**
 * "OUT FOR DELIVERY" — AND WHO IS CARRYING IT?
 *
 * The step sent an order out of the shop without a word about who had it. The
 * rider was a drop-down inside the order's sheet, so an order went "on the way"
 * with nobody's name on it unless somebody had thought to open the sheet first
 * — and the strip that counts deliveries with no rider counted it afterwards,
 * when the customer was already waiting.
 *
 * So the step ASKS. Always, when the order is a delivery and nobody is on it —
 * and never insists: a shop may have made no rider at all, or be sending its
 * own boy who is not in the list. "Send without a rider" is always there.
 */
export function asksWhoCarries(order: Pick<OwnerOrder, "fulfillment_type" | "rider_id">, to: OrderStatus): boolean {
  return to === "out_for_delivery" && order.fulfillment_type === "delivery" && order.rider_id === null;
}

/**
 * The riders it can be given to, the freest first: the one already carrying
 * three is not the first name offered for a fourth.
 */
export function whoCanCarry(riders: readonly Rider[]): Rider[] {
  return riders
    .filter((r) => r.is_active)
    .slice()
    .sort((a, b) => (a.active_deliveries ?? 0) - (b.active_deliveries ?? 0) || a.name.localeCompare(b.name));
}

/** What a rider is doing now, in words. */
export function carryingNow(rider: Pick<Rider, "active_deliveries">): string {
  const n = rider.active_deliveries ?? 0;

  return n === 0 ? "Free" : n === 1 ? "Out with 1 order" : `Out with ${n} orders`;
}
