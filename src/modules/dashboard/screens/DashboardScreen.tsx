/**
 * STUB — structure only.
 *
 * THE LANDING TAB. For a shop that sells only online, this app IS the
 * business, so this screen is not a summary of somewhere else — it is
 * where the day is read.
 *
 * ── One request answers almost all of it ─────────────────────────────
 *
 *   GET /dashboard
 *
 * That endpoint already returns everything below. Nothing here needs
 * building on the server, and nothing should be recomputed on the phone —
 * `DashboardService` takes the tiles, the deltas and the chart from ONE
 * set of arrays precisely so the three cannot disagree with each other.
 *
 *   today            sales_count · revenue · other_income · refunds
 *                    expenses · profit · customers_count
 *   today.deltas     signed % against the SAME figure yesterday
 *   sales_series     last 7 days, oldest first, ZERO-FILLED
 *   expense_breakdown   this month per category
 *   order_pipeline   pending · preparing · delivery · completed
 *   money_owed       receivable · payable
 *   highlights       top product · category · customer
 *   recent_sales     the last few, to tap into
 *   subscription_state / grace_ends_at
 *
 * ── A delta of null is not zero ──────────────────────────────────────
 *
 * `percentDelta` answers NULL when yesterday was zero, and the note on it
 * is explicit about why: there is no honest percentage against nothing.
 * The pill must be HIDDEN, not printed as "+100%" on a shop's first day.
 *
 * ── The one control on this screen ───────────────────────────────────
 *
 * OPEN / CLOSED. The most urgent switch in the product — the kitchen is
 * behind, close for twenty minutes — and burying it inside Shop settings
 * is how orders get accepted that cannot be made.
 */
