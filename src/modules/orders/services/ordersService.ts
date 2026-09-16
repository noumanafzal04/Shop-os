/**
 * STUB — structure only.
 *
 * The typed endpoints. Nothing else in the module knows a URL.
 *
 *   index      GET  /orders
 *   show       GET  /orders/{id}
 *   advance    POST /orders/{id}/advance
 *   assignRider POST /orders/{id}/assign-rider
 *   cancel     POST /orders/{id}/cancel
 *
 * ── Prices are never sent ────────────────────────────────────────────
 *
 * Standing rule, whole-system: HTTP never supplies `unit_price`, `tax` or
 * `line_total`. A partner app that could price an order is a partner app
 * that could discount one silently.
 */
