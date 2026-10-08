import type { OrderStatus, OwnerOrder } from "./services/ordersService";

/**
 * THE ONE THING TO DO NEXT.
 *
 * Seven stages, and the shop should never have to choose between them: at any
 * point there is exactly one forward move, and offering a menu of six would
 * make a wrong one possible for no benefit. The server enforces the same
 * transitions (see OrderStatus::allowedNext), so this decides what the BUTTON
 * says, never what is permitted.
 *
 * The fork is fulfilment. A delivery leaves the shop — "Out for delivery" — and
 * a pickup does not: it becomes "Ready" and waits on the counter for somebody
 * to walk in. Getting that the wrong way round would tell a customer their food
 * is on a bike that does not exist.
 *
 * `null` means the order is finished, one way or the other, and the card shows
 * no forward action at all rather than a disabled one.
 */
export function nextStep(order: OwnerOrder): { label: string; status: OrderStatus } | null {
  switch (order.status) {
    case "pending":
      return { label: "Confirm", status: "confirmed" };
    case "confirmed":
      return { label: "Start preparing", status: "preparing" };
    case "preparing":
      return order.fulfillment_type === "delivery"
        ? { label: "Out for delivery", status: "out_for_delivery" }
        : { label: "Mark ready", status: "ready" };
    case "ready":
    case "out_for_delivery":
      return { label: "Complete", status: "completed" };
    default:
      return null;
  }
}

/**
 * WHERE IT IS, IN THE CUSTOMER'S WORDS.
 *
 * The customer's list printed the status code itself — "pending", "out for
 * delivery" — while the shop's screen says New and On the way. The same order
 * should not be described in a database's words to the one person who is
 * waiting for it. Pickup and delivery end differently: nobody "delivers" a
 * cake somebody walked in to collect.
 */
export function customerSays(status: OrderStatus, fulfillment: "delivery" | "pickup"): string {
  switch (status) {
    case "pending":
      return "Waiting for the shop";
    case "confirmed":
      return "Accepted";
    case "preparing":
      return "Being prepared";
    case "ready":
      return fulfillment === "pickup" ? "Ready to collect" : "Ready";
    case "out_for_delivery":
      return "On the way";
    case "completed":
      return fulfillment === "pickup" ? "Collected" : "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
