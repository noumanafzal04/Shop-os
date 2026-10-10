<?php

namespace App\Support;

use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;

/**
 * WHAT A TABLE OWES, BEFORE IT PAYS — to the paisa the till will ask for.
 *
 * "Bill please." A waiter could answer that only by settling the tab: the
 * one paper with a total on it was the invoice, and an invoice is printed
 * after the money has changed hands. So the figure was read off a screen, or
 * the tab was settled before the customer had seen a number.
 *
 * ── Why this is not the screen's own arithmetic ──────────────────────
 *
 * The tab screen says "+ tax at the bill" and ESTIMATES that tax from the
 * shop's default rate — its own comment calls an over-estimate "safe",
 * because the invoice carries the real figure. A printed bill is not a place
 * for a safe estimate: it is the amount a customer counts out. A table with
 * tea at 18%, a zero-rated naan and a dish in a tax group owes what the SALE
 * will charge, line by line.
 *
 * So this is the sale path's rule for a tab, written once more and held to
 * it: `TheBillIsWhatTheTillWillAskForTest` settles the same tab and fails if
 * the two totals differ by a paisa. The rule (see CreateSaleAction, "dine-in
 * settlement prices from the tab snapshot but taxes fresh"):
 *
 *   the price is the tab's own snapshot — food already eaten is not repriced
 *   each line is taxed at its product's effective rate today (its tax group,
 *     else its own rate, else the shop's default; nought is exempt)
 *   tax is added on top, and rounded as it accumulates, line by line
 *
 * Only what is still to pay. A line settled earlier — the couple who left
 * and paid for their own — is on its own invoice and is not billed again.
 */
final class TabBill
{
    /**
     * @return array{
     *     lines: list<array{quantity: float, name: string, detail: string, modifiers: list<string>, unit_price: float, line_discount: float, line_total: float, tax_rate: float}>,
     *     subtotal: float,
     *     discount: float,
     *     tax: float,
     *     total: float,
     *     paid_earlier: int,
     * }
     */
    public static function of(RestaurantTicket $ticket, float $defaultTaxRate): array
    {
        $live = $ticket->items()->whereNull('voided_at')->with('product')->orderBy('created_at')->orderBy('id')->get();
        $owed = $live->filter(fn (RestaurantTicketItem $item) => $item->sale_id === null)->values();

        $lines = $owed->map(fn (RestaurantTicketItem $item): array => [
            'quantity' => (float) $item->quantity,
            'name' => (string) $item->product_name,
            'detail' => trim($item->variant_name.' '.$item->unit_name),
            'modifiers' => collect($item->modifiers ?? [])->map(fn ($m) => (string) ($m['name'] ?? ''))->filter()->values()->all(),
            'unit_price' => (float) $item->unit_price,
            'line_discount' => (float) $item->line_discount,
            'line_total' => (float) $item->line_total,
            // The rate as the SALE will read it: the product's today, not a
            // snapshot — a dish whose product is gone is taxed at the default.
            'tax_rate' => $item->product?->effectiveTaxRate($defaultTaxRate) ?? $defaultTaxRate,
        ])->all();

        $subtotal = round(array_sum(array_column($lines, 'line_total')), 2);

        // Exactly the sale's loop: added on top, rounded as it accumulates.
        $tax = 0.0;
        foreach ($lines as $line) {
            if ($line['tax_rate'] <= 0 || $subtotal <= 0) {
                continue;
            }
            $tax = round($tax + $line['line_total'] * $line['tax_rate'] / 100, 2);
        }

        return [
            'lines' => $lines,
            'subtotal' => $subtotal,
            'discount' => round(array_sum(array_column($lines, 'line_discount')), 2),
            'tax' => $tax,
            'total' => round($subtotal + $tax, 2),
            'paid_earlier' => $live->count() - $owed->count(),
        ];
    }
}
