/**
 * STUB — structure only.
 *
 * Read-only. Today, 7 days, 30 days; best sellers; how many orders were
 * refused and why.
 *
 *   GET /dashboard
 *
 * ── Deliberately thin ────────────────────────────────────────────────
 *
 * The panel has real reports — tax year, per-branch, per-cashier, CSV. A
 * phone is where somebody glances between customers, so this is the four
 * numbers that survive being glanced at. Anything that needs a filter bar
 * belongs in the panel and should link there rather than be rebuilt.
 *
 * Gated on `reports.read`; folded into Today when the tab is not shown.
 */
