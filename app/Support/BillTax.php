<?php

namespace App\Support;

/**
 * THE TAX ON A BILL — ONE SUM, WHEREVER A BILL IS MADE.
 *
 * The till worked this out inside `CreateSaleAction` and an order did not
 * work it out at all: the same biryani was 5% dearer at the counter than on
 * the phone or online. An order now charges tax by the till's rule, and a
 * second copy of the arithmetic is how the two would drift — so both ask here.
 *
 * Per line, at the line's own rate (tax group, else the product's rate, else
 * the shop's default; 0 = exempt), on the line's DISCOUNTED share of the bill,
 * so a bill-level discount lowers the taxable base proportionally. Inclusive
 * prices already hold their tax, so the portion inside is extracted; exclusive
 * prices have it added on top. Rounded per line, as the till always has.
 */
final class BillTax
{
    /**
     * @param  iterable<array{line_total: float|int|string, tax_rate: float|int|string|null}>  $lines
     */
    public static function of(iterable $lines, float $subtotal, float $discount, bool $inclusive): float
    {
        $taxableBase = $subtotal - $discount;
        $tax = 0.0;

        foreach ($lines as $line) {
            $rate = (float) $line['tax_rate'];
            if ($rate <= 0 || $subtotal <= 0) {
                continue; // exempt / zero-rated, or nothing to tax
            }
            // Each line's discounted share of the taxable base.
            $lineShare = (float) $line['line_total'] * ($taxableBase / $subtotal);
            if ($inclusive) {
                // Price already holds the tax — extract the portion within:
                // share − share ÷ (1 + rate). The total is not inflated.
                $net = $lineShare / (1 + $rate / 100);
                $tax = round($tax + ($lineShare - $net), 2);
            } else {
                // Exclusive — tax is added on top of the share.
                $tax = round($tax + $lineShare * $rate / 100, 2);
            }
        }

        return $tax;
    }
}
