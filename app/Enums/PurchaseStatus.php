<?php

namespace App\Enums;

/**
 * Purchase-order lifecycle:
 *   draft → ordered → partially_received → received
 * Any open PO can be cancelled. Receiving moves stock IN through the
 * single InventoryService write-path.
 */
enum PurchaseStatus: string
{
    case Draft = 'draft';
    case Ordered = 'ordered';
    case PartiallyReceived = 'partially_received';
    case Received = 'received';
    case Cancelled = 'cancelled';

    /** Still editable / cancellable (not fully received or cancelled). */
    public function isOpen(): bool
    {
        return ! in_array($this, [self::Received, self::Cancelled], strict: true);
    }

    /** Can goods still be received against this PO? */
    public function canReceive(): bool
    {
        return in_array($this, [self::Ordered, self::PartiallyReceived], strict: true);
    }
}
