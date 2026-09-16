/**
 * STUB — structure only.
 *
 *   GET /commission    rate · rate_is_yours · outstanding · charges[]
 *
 * ── What is charged, and what is not ─────────────────────────────────
 *
 * Commission is a share of what the MARKETPLACE sold. Only ever on an
 * online order that COMPLETED — never a walk-in at the till, never a phone
 * order the shop took itself, never a cancelled one. If the marketplace
 * did not bring the customer, there is no commission on the sale.
 *
 * The rate on a charge is a SNAPSHOT taken when it was raised, so an older
 * charge keeps the rate it was billed at even after the rate changes.
 * The screen shows the charge's own `rate_percent`, never today's.
 *
 * `rate_is_yours` distinguishes a rate negotiated for this shop from the
 * platform default — worth saying out loud on a screen about money.
 */
