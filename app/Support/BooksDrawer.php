<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\CashMovement;
use App\Models\CashSession;
use App\Models\Tenant;
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

    /**
     * Whose count cash handed over by this person will land in, said BEFORE
     * they hand it over: `open` (their own real shift), `practice` (only a
     * practice till), `none` (the business has a till and they have no shift)
     * or null (the business has no till at all).
     *
     * A manager refunding from the returns desk with no shift of their own
     * took the notes out of a cashier's drawer that never heard about it —
     * the cashier closed short by exactly the refund. The rule stays the
     * expenses' rule (their own drawer, or nowhere); what changes is that
     * they are told first.
     */
    public static function stateFor(User $user): ?string
    {
        if (self::tillFor($user) !== null) {
            return 'open';
        }
        if (self::isPractice($user)) {
            return 'practice';
        }

        return self::hasTill($user) ? 'none' : null;
    }

    /** True when the only drawer this person has open is a practice one. */
    public static function isPractice(User $user): bool
    {
        return (bool) self::openSessionFor($user)?->isTraining();
    }

    /**
     * Does this person's business have a till at all?
     *
     * A drawer is a thing the POS module brings. An office that only keeps its
     * books — a Finance Manager, or any business sold the Expense & Income
     * module alone — pays its electricity bill in notes from a cash box that
     * this product has never been told about and cannot count.
     */
    public static function hasTill(User $user): bool
    {
        return (bool) $user->tenant?->featureEnabled('pos');
    }

    /**
     * The sentence to hand back when a cash entry moved no drawer — or null
     * when there is no drawer for it to have moved.
     *
     * The two cases read differently on purpose: one is "you have no till
     * open", the other is "the till you have open isn't real".
     *
     * ── Why a business with no till hears nothing ───────────────────────
     *
     * It used to hear this on EVERY cash entry it ever made: "you have no
     * shift open — the drawer was not adjusted", under the word Saved, with
     * the form held open until it was dismissed. To a shop that is a useful
     * sentence: go and open your shift. To a business with no POS module it
     * names two things it does not have and cannot get, as though it had
     * forgotten to do something — and it said so about its rent, its tea
     * money and its petty cash, every time, for as long as it kept books.
     *
     * A warning is a thing somebody can act on. Nobody could act on this one.
     */
    public static function untouchedDrawerWarning(User $user, bool $practice, string $verb = 'Recorded as cash'): ?string
    {
        if (! self::hasTill($user)) {
            return null;
        }

        return $practice
            ? $verb.', but your open shift is a practice till — no real drawer was adjusted.'
            : $verb.', but you have no shift open — the drawer was not adjusted.';
    }

    /**
     * THE DRAWER WAS PAID OUT BEYOND WHAT IT HELD (#AZ14).
     *
     * A shift with a 200 float took 152.25, then paid a supplier 1,000 and an
     * expense 120.50 "from the till". Both went through without a word, and the
     * shift's close sheet later read "Expected −668.00 · Over 668.00" beside
     * "The drawer is empty" — somebody sent looking for money that was never
     * there.
     *
     * Not refused: the money was spent, and refusing the record does not
     * unspend it (the rule a budget follows, see RecordExpenseAction). It is
     * said at the one moment it can still be put right — the rest came from a
     * pocket or the safe, and a Paid in says so.
     */
    public static function overdrawnWarning(?CashMovement $movement): ?string
    {
        if ($movement === null || $movement->direction !== 'out' || $movement->cash_session_id === null) {
            return null;
        }

        $session = CashSession::query()->find($movement->cash_session_id);
        if ($session === null) {
            return null;
        }

        $holds = (float) DrawerMath::for($session)['expected_cash'];
        if ($holds >= -0.001) {
            return null;
        }

        return sprintf(
            'That is more cash than your drawer held, so it now expects %s. If the rest came from somewhere else, record it as a Paid in so the shift balances.',
            number_format($holds, 2),
        );
    }

    /** The trading day a shift belongs to: its day's date, or the shop day it was opened on. */
    public static function dayOf(CashSession $session, ?Tenant $tenant = null): string
    {
        $day = $session->businessDay?->trading_date;

        return $day !== null
            ? $day->toDateString()
            : ShopDay::dateOf($session->opened_at ?? now(), $tenant);
    }

    /** Was this shift opened on an earlier trading day than today's? */
    public static function fromAnEarlierDay(CashSession $session, ?Tenant $tenant = null): bool
    {
        return self::dayOf($session, $tenant) < ShopDay::today($tenant);
    }

    /**
     * A SHOP THAT ASKS FOR SHIFTS RINGS A COUNTER SALE ONLY ON TODAY'S SHIFT.
     *
     * `pos_require_shift` was read by one door — the till's own POST /sales —
     * and asked only whether SOME shift was open. A settled tab, an exchange
     * and a quotation billed at the counter never asked at all; and a shift
     * opened on Tuesday and never closed answered "open" on Thursday, so the
     * till sold all week into Tuesday's drawer and Tuesday's day (the user,
     * 2026-10-15: "settings main open shift required hain to pos main bagair
     * open shift k sell q ho rhi?"). One rule, here, for every counter sale.
     *
     * Cash taken as an advance (a layaway, a job card) is held to it too —
     * `$doing` names what was refused. With no shift it reached no drawer, said
     * nothing, and the money was in nobody's count (L2).
     *
     * Off by default; a shop that does not ask for shifts is not refused.
     */
    public static function mustBeOpenToday(?string $sessionId, ?Tenant $tenant, string $doing = 'ringing up a sale'): void
    {
        if ($tenant === null || ! (bool) ($tenant->setting('pos_require_shift') ?? false)) {
            return;
        }

        $session = $sessionId === null ? null : CashSession::query()->with('businessDay')->find($sessionId);

        if ($session === null || $session->status !== 'open') {
            throw DomainException::conflict("Open a shift before {$doing}.", 'SHIFT_REQUIRED');
        }

        if (self::fromAnEarlierDay($session, $tenant)) {
            throw DomainException::conflict(
                'This shift has been open since '.ShopTime::day(self::dayOf($session, $tenant), $tenant)
                ." — close it and open today's before {$doing}.",
                'SHIFT_FROM_AN_EARLIER_DAY',
            );
        }
    }
}
