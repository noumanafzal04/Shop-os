<?php

namespace App\Support;

use App\Models\CashSession;
use App\Models\User;

/**
 * Whether the actor has a drawer that REAL money may be posted to.
 *
 * An expense and an income are always real. There is no practice expense —
 * the row lands in the books, the cashbook, the ledger and every report the
 * moment it is filed. A practice SHIFT is the opposite: everything rung on it
 * is discarded, which is the whole point of it.
 *
 * Pair the two and both halves break. The `expense_out` goes against the
 * practice till, so:
 *
 *   the REAL drawer never learns the cash left it, and closes short by exactly
 *   that amount with nothing to explain it — the precise failure this module
 *   exists to prevent, arriving through the back door;
 *
 *   the expense is stamped with a movement on a practice shift, so the moment
 *   that shift is closed the entry is frozen for good ("paid out of a shift
 *   that has already been counted") and a genuine bill can never be corrected.
 *
 * So a practice shift is treated exactly like no shift at all: the entry is
 * still recorded, because the money genuinely was spent, and the person is
 * told the drawer was not touched — which is the same sentence they already
 * get when they file a cash bill from the office at midnight.
 */
class BooksDrawer
{
    /** The actor's open shift, whether or not it may take real money. */
    public static function openSessionFor(User $user): ?CashSession
    {
        return CashSession::query()
            ->where('user_id', $user->id)
            ->where('status', 'open')
            ->first();
    }

    /**
     * The drawer this person's counter money belongs in — or null.
     *
     * ── The asymmetry this closes ───────────────────────────────────────
     *
     * Money LEAVING the drawer already resolves itself: a cash expense, a
     * supplier paid in notes, a paid-out — `RecordCashMovementAction` looks up
     * the caller's own open shift server-side, and its docblock says so
     * outright. Money ARRIVING did not. A sale carried `cash_session_id` only
     * when the caller thought to send it, and exactly one caller ever did.
     *
     * The till sends it. The Sales screen's New Sale form does not, the
     * returns desk has no field for it at all, a settled dine-in tab passes
     * through whatever it was given, and so does a quotation turned into an
     * invoice. So a shop with a drawer open could take cash all afternoon
     * through any of those and the drawer would expect none of it — while the
     * afternoon's expenses came out of it perfectly.
     *
     * That is not an abstract mismatch. `BusinessDay` sums the SHIFTS, so a
     * day traded that way closes off reading zero takings, and the cashier
     * counts a drawer that is over by the day's cash with nothing to explain
     * it. `SaleController` already names the fault in its own comment —
     * "whose cash belongs to no reconciliation and shows up in no shift
     * report" — and answers it only for shops that opted into
     * `pos_require_shift`, which ships off.
     *
     * ── Why a practice till answers null ────────────────────────────────
     *
     * A sale inherits `is_training` from the drawer it is rung on. Resolving a
     * practice shift here would silently turn a real customer's sale into a
     * practice one — no stock moved, no revenue earned, invisible in every
     * report. Exactly what `isPractice` above exists to prevent for expenses,
     * for the same reason.
     */
    public static function tillFor(?User $user): ?CashSession
    {
        if ($user === null) {
            return null;
        }

        $session = self::openSessionFor($user);

        return $session !== null && ! $session->isTraining() ? $session : null;
    }

    /** True when the only drawer this person has open is a practice one. */
    public static function isPractice(User $user): bool
    {
        return (bool) self::openSessionFor($user)?->isTraining();
    }

    /**
     * The sentence to hand back when a cash entry moved no drawer. The two
     * cases read differently on purpose: one is "you have no till open", the
     * other is "the till you have open isn't real".
     */
    public static function untouchedDrawerWarning(bool $practice, string $verb = 'Recorded as cash'): string
    {
        return $practice
            ? $verb.', but your open shift is a practice till — no real drawer was adjusted.'
            : $verb.', but you have no shift open — the drawer was not adjusted.';
    }
}
