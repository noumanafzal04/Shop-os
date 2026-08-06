<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The four digits on a tyre's sidewall.
 *
 * "2224" means week 22 of 2024 — the week that tyre was built. Every tyre made
 * since 2000 carries one, and it is the only honest answer to "how old is this
 * tyre?", because rubber ages on a shelf whether or not anyone drives on it.
 *
 * Deliberately NOT modelled as an expiry date. Nothing becomes illegal on a
 * given day; a shop needs to see the age, sell the oldest stock first, and be
 * warned before a customer notices. Treating it as expiry would block a sale
 * the shopkeeper is entitled to make and, worse, hide the far more common case:
 * a tyre that is perfectly saleable but should go before the newer pallet.
 *
 * The industry's rough consensus, and the default here: warn at five years,
 * treat six as old. Both are settings, because a fleet contract may be stricter
 * and a shop in a hot climate has its own view.
 */
class DotCode
{
    /** A DOT code is four digits: WWYY. */
    public const PATTERN = '/^\d{4}$/';

    /**
     * The Monday of the week a code names. Null for anything that isn't a
     * plausible code — week 00 and weeks past 53 do not exist, and a typo
     * should read as "no date" rather than a date in 1970.
     */
    public static function toDate(?string $code): ?Carbon
    {
        if ($code === null || preg_match(self::PATTERN, $code) !== 1) {
            return null;
        }

        $week = (int) substr($code, 0, 2);
        $shortYear = (int) substr($code, 2, 2);

        if ($week < 1 || $week > 53) {
            return null;
        }

        // Two digits, so the century is inferred. A code cannot name a tyre
        // built in the future, so anything ahead of this year belongs to the
        // previous century — which keeps "99" reading as 1999 rather than 2099
        // without hard-coding a cutoff that goes stale.
        $year = 2000 + $shortYear;
        if ($year > (int) now()->year) {
            $year -= 100;
        }

        // ISO week, not "Jan 1 plus N weeks". Jan 1 is rarely a Monday, so
        // anchoring on it and walking back to the start of that week lands in
        // the PREVIOUS year — 0199 came out as 1998.
        return Carbon::now()->setISODate($year, $week)->startOfDay();
    }

    /** Whole months since manufacture — null when the date is unknown. */
    public static function ageMonths(?Carbon $manufacturedOn): ?int
    {
        return $manufacturedOn?->diffInMonths(now());
    }

    /**
     * How a shop should read this lot's age.
     *
     *   fresh  — sell it
     *   ageing — sell it BEFORE the newer stock, and say so on the shelf
     *   old    — past what most buyers accept; price it or return it
     *
     * Null when nothing was recorded, which is not the same as fresh and must
     * never be shown as such.
     */
    public static function status(?Carbon $manufacturedOn, int $warnYears = 5, int $oldYears = 6): ?string
    {
        $months = self::ageMonths($manufacturedOn);
        if ($months === null) {
            return null;
        }

        return match (true) {
            $months >= $oldYears * 12 => 'old',
            $months >= $warnYears * 12 => 'ageing',
            default => 'fresh',
        };
    }

    /** "3 yr 2 mo" — how a counter says it out loud. */
    public static function humanAge(?Carbon $manufacturedOn): ?string
    {
        $months = self::ageMonths($manufacturedOn);
        if ($months === null) {
            return null;
        }

        $years = intdiv($months, 12);
        $rest = $months % 12;

        if ($years === 0) {
            return $rest === 1 ? '1 mo' : "{$rest} mo";
        }

        return $rest === 0 ? "{$years} yr" : "{$years} yr {$rest} mo";
    }
}
