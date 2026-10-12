<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * NOT AN ERROR — an answer.
 *
 * A screen that takes money has to show the figure the sale will ask for, and
 * there is one place that knows it: the sale path itself, with its tax per
 * line, its member's discount, its coins. Every screen that added the bill up
 * on its own has been wrong at some point, and each time by an amount a
 * customer was asked to pay.
 *
 * So the sale path can be ASKED. It runs exactly as it would to ring the sale,
 * and at the moment it knows what is due — before it has written anything — it
 * stops by throwing this, carrying the figures. Whoever asked catches it, and
 * the transaction they opened is rolled back with whatever their own
 * preparation did (a tab line carved in two, a coupon read).
 *
 * It is never raised for a caller that did not ask, and never reaches a
 * response.
 */
final class SaleQuoted extends RuntimeException
{
    /**
     * @param  array<string, float>  $figures  payable, amount_due, rounding, subtotal, discount, tax, total, tip…
     */
    public function __construct(public readonly array $figures)
    {
        parent::__construct('A sale was asked about, not rung.');
    }
}
