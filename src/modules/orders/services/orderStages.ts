/**
 * WHERE AN ORDER MAY GO NEXT.
 *
 * ── Why this is mirrored rather than asked for ───────────────────────
 *
 * The payload does not carry it. The server owns the rule —
 * `OrderStatus::nextStates()` — and enforces it: an illegal move comes back
 * `ORDER_INVALID_TRANSITION`, so the worst this copy can do is offer a button
 * that then fails, never move an order somewhere it should not go.
 *
 * But a button that always fails is its own defect, so this copy is checked
 * against the server's enum by `orderStages.test.ts`, which reads the PHP and
 * compares. A mirror nobody checks is a fork.
 *
 * ── The one branch in it ─────────────────────────────────────────────
 *
 * A delivery goes Preparing → Out for delivery. A pickup goes Preparing →
 * Ready. Same stage, two different next steps, and offering "Out for delivery"
 * on a collection order is how a customer standing at the counter is told
 * their food is on a bike.
 */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type FulfillmentType = "delivery" | "pickup" | "dine_in";

export function nextStates(status: OrderStatus, fulfillment: FulfillmentType): OrderStatus[] {
  switch (status) {
    case "pending":
      return ["confirmed", "cancelled"];
    case "confirmed":
      return ["preparing", "cancelled"];
    case "preparing":
      return fulfillment === "delivery"
        ? ["out_for_delivery", "cancelled"]
        : ["ready", "cancelled"];
    case "ready":
    case "out_for_delivery":
      return ["completed", "cancelled"];
    case "completed":
    case "cancelled":
      return [];
  }
}

export const isOpen = (status: OrderStatus): boolean =>
  status !== "completed" && status !== "cancelled";

/**
 * What the button SAYS — the action, never the state.
 *
 * "Confirmed" is a fact about an order; "Accept order" is a thing a person
 * does. A row of buttons named after states makes somebody translate before
 * they can press, which during service is a pause they do not have.
 */
export const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: "Accept order",
  confirmed: "Accept order",
  preparing: "Start preparing",
  ready: "Ready for collection",
  out_for_delivery: "Send out",
  completed: "Complete",
  cancelled: "Reject",
};

/** What the CHIP says — the state, because that is what it is reporting. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};
