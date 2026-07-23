<?php

namespace App\Enums;

enum SaleStatus: string
{
    case Completed = 'completed';
    case PartiallyRefunded = 'partially_refunded';
    case Refunded = 'refunded';
    case Cancelled = 'cancelled';

    /** A sale that has been sold (not voided) — returnable. */
    public function isReturnable(): bool
    {
        return in_array($this, [self::Completed, self::PartiallyRefunded], strict: true);
    }
}
