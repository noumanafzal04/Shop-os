<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * The year a Pakistani business is actually measured by.
 *
 * ── Why "this year" was the wrong twelve months ─────────────────────────
 *
 * Every report on this platform resolved "yearly" to 1 January – 31 December.
 * That is not the year any business here files. FBR's tax year runs **1 July to
 * 30 June**, and it is the window behind the annual return, the audited
 * accounts, and every advance-tax working under section 147. A calendar-year
 * total is a figure nobody submits anywhere.
 *
 * It bites hardest on the tenant whose entire product is the books — the
 * Finance Manager type has no catalog, no stock and no till, so a date shortcut
 * is not a convenience there, it is the screen.
 *
 * ── It is ADDED, never substituted ──────────────────────────────────────
 *
 * A shopkeeper asking "is saal kitna kamaya" usually does mean January to
 * December, and taking that away to hand them their accountant's year would be
 * answering a question they didn't ask. Both windows are real; they are
 * different questions, so they are different buttons.
 *
 * ── Not a setting ───────────────────────────────────────────────────────
 *
 * July–June is statutory here, this platform is PKR-only and Pakistan-only, and
 * a setting that 99% of tenants must never touch is a setting the other 1%
 * gets wrong. The rule lives in this one class instead, which is the thing a
 * per-tenant year would need anyway if it were ever genuinely wanted.
 *
 * Both sides compute this — mirrored in `reportPeriod.ts` and `moneyFilters.ts`.
 * That duplication has already cost this codebase one defect (a week starting
 * Sunday in the panel and Monday on the server, two tabs of one screen a day
 * apart), which is why the rule is stated once, here, and tested on both sides.
 */
final class TaxYear
{
    /** The month a tax year opens on. July. */
    public const STARTS_IN_MONTH = 7;

    /**
     * The tax year containing a given day.
     *
     * The boundary is the whole point: 30 June closes the year that began the
     * previous July, and 1 July opens the next one.
     *
     * @return array{from: string, to: string}
     */
    public static function containing(CarbonImmutable $day): array
    {
        $startYear = $day->month >= self::STARTS_IN_MONTH ? $day->year : $day->year - 1;
        $from = CarbonImmutable::create($startYear, self::STARTS_IN_MONTH, 1);

        return [
            'from' => $from->toDateString(),
            // Exactly one year later, less a day: 30 June, without hard-coding
            // a month length.
            'to' => $from->addYear()->subDay()->toDateString(),
        ];
    }
}
