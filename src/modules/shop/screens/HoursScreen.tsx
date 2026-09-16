/**
 * STUB — structure only.
 *
 * Seven rows, open and close per day.
 *
 * ── Empty hours mean ALWAYS OPEN ─────────────────────────────────────
 *
 * `Tenant::isOpenNow()` returns true when no schedule is set, and false
 * for a day the schedule omits. Both are easy to set by accident from a
 * phone, and both decide whether the shop appears in the customer app at
 * all. The screen has to say which state it is in, in words.
 */
