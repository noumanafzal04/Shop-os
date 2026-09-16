/**
 * STUB — structure only.
 *
 * The catalogue as a shopkeeper uses it during a shift: find the item,
 * turn it off, fix its price.
 *
 *   GET /products?q=…&category_id=…
 *
 * ── Sold-out is the reason this tab exists ───────────────────────────
 *
 * Not "edit a product" — that is a form somebody fills in once. What
 * happens every single day is a thing running out, and the whole job is
 * one switch on a row:
 *
 *   POST   /products/{id}/sold-out
 *   DELETE /products/{id}/sold-out
 *   …and the per-size pair, because a large can run out while a small has not
 *
 * The rule is shared across all three selling paths (till, online, phone
 * order) on the server. This screen sets it; it does not interpret it.
 */
