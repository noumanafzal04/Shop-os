import type { SaleHit } from "./services/searchService";

/**
 * The second line of a sale row in the command palette.
 *
 * ── Why this is a function and not a ternary in the row ─────────────────
 *
 * A sale rung with no server prints `OFF-LANE1-A3F2-000042` and gets its real
 * invoice number later, on sync. The server keeps both, and the search matches
 * both — so a customer holding that slip can be found.
 *
 * Found is not the same as recognised. If the row shows only `INV-1043`, the
 * person who typed the slip number is looking at a number they have never seen,
 * with no way to tell whether it is the sale in their hand. **A lookup that
 * cannot be confirmed is half a lookup**, and the confirmation has to be the
 * thing they typed.
 *
 * Pulled out so the rule can be tested and cannot be quietly dropped the next
 * time the row is restyled.
 */
export function saleSubtitle(hit: Pick<SaleHit, "offline_number" | "customer_name">): string {
  // Walk-in rather than blank: an empty second line reads as missing data, and
  // most sales in a shop genuinely have no customer attached.
  const who = hit.customer_name ?? "Walk-in";

  return hit.offline_number ? `${hit.offline_number} · ${who}` : who;
}
