/**
 * STUB — structure only.
 *
 * WHICH TABS THIS PERSON GETS, decided in ONE place.
 *
 * `GET /auth/me` returns `permissions[]` and `tenant.features`. A tab the
 * signed-in user cannot use is never rendered — not greyed out, not shown
 * and then refused on open.
 *
 * ── Why one file and not a check per screen ──────────────────────────
 *
 * This codebase has the scar. Four separate guards once read one route
 * list, so adding a screen meant remembering six places; and a kitchen
 * preset was offered a board by four surfaces and bounced by the fifth.
 * One map, read by the tab bar and by the navigator, or the two disagree.
 *
 * Roughly:
 *   Today      always
 *   Orders     orders.manage
 *   Menu       products.manage
 *   Shop       settings.manage
 *   Insights   reports.read   (folded into Today when absent)
 *   Account    always
 */
