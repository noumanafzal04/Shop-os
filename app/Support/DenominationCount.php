<?php

namespace App\Support;

/**
 * Counting a drawer by what is physically in it.
 *
 * A cashier who types a total has already done the arithmetic in their head,
 * and the drawer's real composition — which is the only thing another person
 * can re-check — is gone. Counting 3×5000, 12×1000, 8×500 derives the total
 * instead of trusting it, and catches the honest error a total never does: a
 * note miscounted as a different note.
 */
class DenominationCount
{
    /**
     * Pakistani currency, largest first — the order a person counts in.
     *
     * Notes and coins are one list because a drawer is one drawer; the coin
     * tray is not a separate accounting entity. Rs 1 and 2 are still legal
     * tender and still turn up in a mart's coin cup, so they stay.
     */
    public const PKR = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

    /**
     * Total of a {denomination: count} map.
     *
     * Unknown or non-positive denominations are ignored rather than guessed
     * at: a shop on a different currency simply gets no total from a PKR
     * breakdown, which is visible, instead of a wrong one, which isn't.
     *
     * @param  array<int|string, int|string>|null  $counts
     */
    public static function total(?array $counts, array $denominations = self::PKR): float
    {
        if (empty($counts)) {
            return 0.0;
        }

        $total = 0.0;

        foreach ($counts as $value => $qty) {
            $value = (int) $value;
            $qty = (int) $qty;

            if ($value <= 0 || $qty <= 0 || ! in_array($value, $denominations, true)) {
                continue;
            }

            $total += $value * $qty;
        }

        return round($total, 2);
    }

    /**
     * Drop the zero rows before storing.
     *
     * A count of every denomination with most set to zero is noise on a Z-read
     * that someone has to scan by eye at the end of a long shift.
     *
     * @param  array<int|string, int|string>|null  $counts
     * @return array<string, int>|null
     */
    public static function clean(?array $counts, array $denominations = self::PKR): ?array
    {
        if (empty($counts)) {
            return null;
        }

        $out = [];

        foreach ($counts as $value => $qty) {
            $value = (int) $value;
            $qty = (int) $qty;

            if ($value > 0 && $qty > 0 && in_array($value, $denominations, true)) {
                $out[(string) $value] = $qty;
            }
        }

        if ($out === []) {
            return null;
        }

        // Largest first, so a printed count reads the way it was taken.
        uksort($out, fn ($a, $b) => (int) $b <=> (int) $a);

        return $out;
    }
}
