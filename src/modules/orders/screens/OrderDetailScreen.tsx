/**
 * STUB — structure only.
 *
 * One order, and every decision a shop makes about it.
 *
 *   POST /orders/{id}/advance        confirmed → preparing → ready → …
 *   POST /orders/{id}/assign-rider
 *   POST /orders/{id}/cancel
 *
 * ── What the screen must show before it asks for a decision ──────────
 *
 * The items with their modifiers and sizes, the customer's address AND its
 * map pin, the fulfilment type, what it totals, and how it is being paid.
 * Accepting an order whose address you cannot read is how a delivery fails
 * at the gate.
 *
 * ── The stage machine belongs to the server ──────────────────────────
 *
 * `OrderService` refuses an illegal transition and pickup never becomes
 * "out for delivery". This screen offers the next legal stage and shows
 * the server's refusal verbatim — it must not keep its own copy of the
 * rule, which is how the panel and the app end up disagreeing about what
 * "ready" means.
 *
 * A print button sits here — see `modules/printing`.
 */
