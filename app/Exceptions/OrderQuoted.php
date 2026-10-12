<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * An order was ASKED ABOUT, not placed.
 *
 * Thrown from inside `OrderService::place()` at the first line the bill is
 * known and before anything is written, so the transaction around it rolls
 * back — a coupon looked at is not a coupon spent. The same shape as
 * `SaleQuoted`: a screen that takes money asks the path that will take it.
 */
final class OrderQuoted extends RuntimeException
{
    /** @param  array<string, mixed>  $figures */
    public function __construct(public readonly array $figures)
    {
        parent::__construct('An order was asked about, not placed.');
    }
}
