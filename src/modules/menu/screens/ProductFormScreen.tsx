/**
 * STUB — structure only.
 *
 *   POST/PUT /products/{id}
 *   POST     /products/{id}/images       ONE file — it REPLACES
 *   DELETE   /products/{id}/images/{id}
 *
 * ── One product, one picture ─────────────────────────────────────────
 *
 * The server replaces rather than appends, and refuses a second file in
 * the same request. This form must offer ONE picker and say "Replace
 * photo" when there is already one — the panel said "Add photos" while the
 * server appended, and somebody correcting a bad photo got a second one
 * with the bad one still first.
 *
 * And the Remove control must be VISIBLE without hovering. On the panel it
 * was `opacity-0` until hover, so on a tablet the picture could not be
 * deleted at all. There is no hover on a phone whatsoever.
 *
 * ── Deliberately not the panel's form ────────────────────────────────
 *
 * The panel's product form has four tabs — media, sizes and options, codes
 * and packs, opening stock. That is a desk job. This one carries name,
 * price, category, photo, sold-out, and a link to the panel for the rest.
 * A phone form that tries to do all of it is a phone form nobody finishes.
 */
