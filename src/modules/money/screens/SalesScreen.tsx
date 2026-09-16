/**
 * STUB — structure only.
 *
 * Every sale, newest first, with its own detail.
 *
 *   GET /sales?from=&to=&q=
 *   GET /sales/{id}
 *   GET /sales/{id}/invoice
 *
 * ── An online order becomes a sale ───────────────────────────────────
 *
 * A completed delivery lands in the ledger as a Sale — so this list is
 * where an order ENDS, and the Orders tab is where it lives while it is
 * still moving. Two tabs, two stages of one thing, and the detail screen
 * links back to the order it came from.
 *
 * Read-only. Cancelling or exchanging a sale moves stock and money, and
 * that belongs on the panel where the whole picture is visible.
 */
