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
     * Pakistani notes and coins — what this class counted before a shop could
     * trade in anything else, kept as the default for a caller that names no
     * currency. Every currency's own list is in App\Support\Currencies.
     */
    public const PKR = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

    /**
     * What a drawer in this currency is counted in, largest first.
     *
     * Notes and coins are one list because a drawer is one drawer; the coin
     * tray is not a separate accounting entity. A dollar drawer has quarters
     * and cents in it, so a denomination is not always a whole number.
     *
     * @return list<int|float>
     */
    public static function for(?string $currency): array
    {
        return Currencies::cash($currency);
    }

    /**
     * One denomination as a key: "5000", "0.25". A map of counts arrives as
     * JSON, where 0.25 and "0.250" and "0.25" must all be the same coin.
     */
    public static function key(int|float|string $value): string
    {
        $text = rtrim(rtrim(number_format((float) $value, 2, '.', ''), '0'), '.');

        return $text === '' ? '0' : $text;
    }

    /**
     * Total of a {denomination: count} map.
     *
     * Unknown or non-positive denominations are ignored rather than guessed
     * at: a note this currency does not have simply adds nothing, which is
     * visible, instead of a wrong total, which isn't.
     *
     * @param  array<int|string, int|string>|null  $counts
     * @param  array<int, int|float>  $denominations
     */
    public static function total(?array $counts, array $denominations = self::PKR): float
    {
        return round(array_sum(array_map(
            static fn (string $value, int $qty): float => (float) $value * $qty,
            array_keys(self::clean($counts, $denominations) ?? []),
            array_values(self::clean($counts, $denominations) ?? []),
        )), 2);
    }

    /**
     * Drop the zero rows before storing.
     *
     * A count of every denomination with most set to zero is noise on a Z-read
     * that someone has to scan by eye at the end of a long shift.
     *
     * @param  array<int|string, int|string>|null  $counts
     * @param  array<int, int|float>  $denominations
     * @return array<string, int>|null
     */
    public static function clean(?array $counts, array $denominations = self::PKR): ?array
    {
        if (empty($counts)) {
            return null;
        }

        $known = array_map(self::key(...), $denominations);
        $out = [];

        foreach ($counts as $value => $qty) {
            $key = self::key($value);
            $qty = (int) $qty;

            if ((float) $key > 0 && $qty > 0 && in_array($key, $known, true)) {
                $out[$key] = ($out[$key] ?? 0) + $qty;
            }
        }

        if ($out === []) {
            return null;
        }

        // Largest first, so a printed count reads the way it was taken.
        uksort($out, fn ($a, $b) => (float) $b <=> (float) $a);

        return $out;
    }
}
