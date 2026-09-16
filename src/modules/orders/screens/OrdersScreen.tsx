/**
 * STUB — structure only.
 *
 * THE MODULE THIS APP EXISTS FOR.
 *
 *   GET /orders                 the queue, with a count per stage
 *   GET /orders?stage=…&q=…     narrowed
 *
 * ── The stages, and the counts ───────────────────────────────────────
 *
 * The endpoint already returns a count for EVERY stage including the empty
 * ones, and those counts are taken without the stage filter applied — so
 * the tab strip does not change under a shopkeeper's thumb as they move
 * between stages. That behaviour is proved on the server by
 * `TheOrderQueueTest`; this screen must not re-derive it from the rows it
 * happens to have loaded.
 *
 * ── Live, not polled to death ────────────────────────────────────────
 *
 * Until push exists (DECISIONS #1) this is an honest poll with a visible
 * "last checked" — the customer app's `RefreshPill` pattern, which exists
 * because a screen saying "Up to date" beside a stale badge was worse than
 * saying nothing.
 */
