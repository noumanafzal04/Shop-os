/**
 * STUB — structure only.
 *
 * "Kitna kamaya" — over a period the shopkeeper picks.
 *
 *   GET /reports/summary?period=daily|weekly|monthly|yearly|tax_year|custom
 *
 * The periods are the server's, including PK **tax year (1 Jul – 30 Jun)**,
 * which sits beside the calendar year and is not a setting. A phone that
 * invented its own date ranges would disagree with the panel on the one
 * screen an accountant looks at.
 *
 * ── What "earned" actually means here ────────────────────────────────
 *
 * Revenue is not earnings. The chain, and every step already has a figure:
 *
 *   revenue            what was sold
 *   − cost of goods
 *   − expenses         what the shop recorded
 *   − commission       the platform's cut on ONLINE orders only
 *   = what is left
 *
 * Refunds are published BESIDE revenue rather than netted into it — a
 * refund is dated by the day it went out, and folding it in would rewrite
 * the day the sale came in. The screen must keep them apart for the same
 * reason.
 */
