/**
 * STUB — structure only.
 *
 * The shop as the app currently believes it to be: open or closed,
 * delivery on or off, and which modules the plan includes.
 *
 * Held in a store rather than read per screen because three surfaces show
 * it at once — the Today header, the Shop tab, and the refusal an order
 * screen gives when the shop is shut. Three reads is how one of them ends
 * up stale.
 */
