<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * "Is this offer running right now?" — asked once, for everything that asks it.
 *
 * ── Why this is a support class and not a method on a model ─────────────
 *
 * Two different things now carry the same four fields: a shop's own promotion,
 * and a bank's card offer. They will not be the last — a supplier-funded deal is
 * the obvious third.
 *
 * The tempting shape is a `liveNow(Promotion $p)` on one service and a
 * `liveNow(BankCardOffer $o)` on another. They start identical and they do not
 * stay identical: somebody fixes the midnight-wrapping window in one of them,
 * or reads `days_of_week` as 1=Monday in one and 0=Sunday in the other, and now
 * the shop's Friday offer and the bank's Friday offer disagree about what Friday
 * means. That drift is not hypothetical here — this codebase has already paid
 * for it once, when the offline pricing mirror silently stopped applying
 * promotions the server was applying.
 *
 * So the rule takes FIELDS, not a model. Nothing can implement it slightly
 * differently, because there is only one of it.
 *
 * ── The three questions, and the one that is easy to get wrong ──────────
 *
 *   1. Is today inside the campaign?      `starts_on` … `ends_on`, inclusive
 *   2. Is today one of its days?          `days_of_week`, 0 = Sunday
 *   3. Is now inside its hours?           `start_time` … `end_time`
 *
 * The third wraps midnight. "22:00 to 02:00" is a real shape — a night canteen,
 * a late-night bank offer — and read naively it is empty, so the offer simply
 * never fires and nobody can work out why.
 *
 * `$now` MUST already be in the shop's timezone. A promotion that runs on
 * Fridays is a statement about the shop's Friday, and judging it in UTC starts
 * a Karachi evening offer five hours early and ends it five hours early too.
 */
class OfferWindow
{
    /**
     * @param  array<int, int|string>|null  $daysOfWeek  0 = Sunday. Null or empty = every day.
     */
    public static function isLive(
        Carbon $now,
        ?Carbon $startsOn,
        ?Carbon $endsOn,
        ?array $daysOfWeek,
        ?string $startTime,
        ?string $endTime,
    ): bool {
        $today = $now->copy()->startOfDay();

        if ($startsOn !== null && $today->lt($startsOn->copy()->startOfDay())) {
            return false;
        }

        if ($endsOn !== null && $today->gt($endsOn->copy()->startOfDay())) {
            return false;
        }

        $days = $daysOfWeek ?? [];
        if ($days !== [] && ! in_array((int) $now->dayOfWeek, array_map('intval', $days), true)) {
            return false;
        }

        // Both ends or neither. One alone says nothing about a window, and
        // guessing the other end is how an offer runs for a minute a day.
        if ($startTime !== null && $endTime !== null) {
            $at = $now->format('H:i:s');
            $from = self::hms($startTime);
            $to = self::hms($endTime);

            $inWindow = $from <= $to
                ? ($at >= $from && $at <= $to)
                // Wraps midnight: 22:00–02:00 means late OR early, not neither.
                : ($at >= $from || $at <= $to);

            if (! $inWindow) {
                return false;
            }
        }

        return true;
    }

    /** "18:00" and "18:00:00" are the same instant; only one of them sorts. */
    private static function hms(string $time): string
    {
        return strlen($time) === 5 ? $time.':00' : $time;
    }
}
