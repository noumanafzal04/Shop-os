<?php

namespace App\Enums;

/**
 * Lifecycle of a dine-in / takeaway running tab.
 *   open   → accumulating items, can fire KOTs, can settle
 *   closed → fully settled (every non-void item has a sale)
 *   void   → abandoned before any settlement (walk-out, mistake)
 */
enum RestaurantTicketStatus: string
{
    case Open = 'open';
    case Closed = 'closed';
    case Void = 'void';

    public function isOpen(): bool
    {
        return $this === self::Open;
    }
}
