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
