<?php

namespace App\Support;

/**
 * Settling a cash bill to a coin that exists.
 *
 * Sub-rupee coins do not circulate in Pakistan, and a great many counters
 * cannot break a five. A bill of Rs 1,247.63 therefore has no exact cash
 * tender: the cashier takes 1,250 and hands back whatever they have. That
 * difference used to land in the drawer variance — the single number a shop
 * uses to detect theft — a few paisa at a time, on every cash sale, forever.
 * A real Rs 200 shortage is invisible inside a month of accumulated change.
 *
 * Two rules make this safe, and both matter:
 *
 *  - THE BILL IS NOT CHANGED. `total` stays exact, because tax is computed on
 *    it and a rounding rule must never move a tax figure. What is rounded is
 *    the amount DUE IN CASH, and the difference is recorded on its own as
 *    `rounding_adjustment`, so a receipt can show it and a report can add it
 *    back up.
 *
 *  - ONLY CASH ROUNDS. A card terminal takes 1,247.63 without complaint, and a
 *    khata balance is a number in a ledger, not coins in a hand. Rounding
 *    anything that is not physically counted out would be inventing money.
 *
 * A tie goes DOWN, in the customer's favour: at 5-rupee rounding, 1,247.50
 * settles at 1,245, not 1,250. A shop that surprises people upward at the
 * counter gets asked about it, and being wrong by two-fifty in your own favour
 * is not worth the conversation.
 */
class CashRounding
{
    /** The increments a shop may settle to. 0 = off (exact to the paisa). */
    public const INCREMENTS = [0, 1, 5, 10];

    /**
     * The amount actually handed over, for a bill of $due settled in cash.
     *
     * Returns $due untouched when the shop does not round, so every caller can
     * apply this unconditionally.
     */
    public static function apply(float $due, int $increment): float
    {
        if ($increment <= 0 || ! in_array($increment, self::INCREMENTS, true)) {
            return round($due, 2);
        }

        $units = $due / $increment;
        $floor = floor($units);
        $remainder = $units - $floor;

        // Ties (exactly half an increment) go down — see the class note.
        $rounded = ($remainder > 0.5 ? $floor + 1 : $floor) * $increment;

        return round((float) $rounded, 2);
    }

    /**
     * What rounding did to this bill: negative when the shop gave up the
     * difference, positive when it collected it. Zero when rounding is off, so
     * a shop that never turned it on has an unbroken run of exact sales.
     */
    public static function adjustment(float $due, int $increment): float
    {
        return round(self::apply($due, $increment) - round($due, 2), 2);
    }

    /**
     * Does this settlement get rounded?
     *
     * Only when every tender is cash. A card or bank slice is exact by nature,
     * and a credit slice is a ledger entry rather than coins — rounding a bill
     * that is partly going on khata would push the difference into a balance
     * the customer settles later, which is not what rounding is for.
     *
     * An empty tender list is not a cash sale (nothing was handed over), and a
     * trade-in or points slice is goods and loyalty, not currency.
     *
     * @param  list<string>  $methods  every tender method on the sale
     */
    public static function settlesInCashOnly(array $methods): bool
    {
        $methods = array_values(array_unique(array_filter($methods)));

        return $methods !== [] && $methods === ['cash'];
    }
}
