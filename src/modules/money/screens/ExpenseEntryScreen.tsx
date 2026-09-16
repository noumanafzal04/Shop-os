/**
 * STUB — structure only. The ONE thing in this module that writes.
 *
 *   POST /expenses      amount · category · note · date · bill photo
 *
 * ── Why a write belongs here at all ──────────────────────────────────
 *
 * The dashboard publishes `profit`, and profit is revenue minus cost minus
 * EXPENSES. A shop that runs entirely from this app and has no way to
 * record a delivery bag, a gas cylinder or a rider's fuel is a shop shown
 * a profit figure that is simply too high — every day, with no sign that
 * anything is missing.
 *
 * ── Deliberately the smallest possible form ──────────────────────────
 *
 * Amount, category, note, date, and a photo of the bill. NOT the panel's
 * expense manager: no budgets, no recurring templates, no supplier
 * linkage, no drawer reconciliation. Those are a desk job and are linked
 * to rather than rebuilt.
 *
 * The bill photo is private — served only to somebody who could already
 * read the row.
 */
