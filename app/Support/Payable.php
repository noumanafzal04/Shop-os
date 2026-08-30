<?php

namespace App\Support;

use App\Enums\PurchaseStatus;
use App\Models\PurchaseOrder;
use Illuminate\Database\Eloquent\Builder;

/**
 * WHAT THE SHOP OWES ITS SUPPLIERS — asked in one place.
 *
 * The question had three answers. The supplier card counted every order that
 * was not cancelled, so a DRAFT — a basket somebody is still filling — was
 * billed to the shop as a debt and put a red figure and a Pay button on the
 * row. The dashboard excluded drafts and said a smaller number. The purchases
 * report agreed with neither. Same debt, three screens, three totals.
 *
 * A draft is a shopping list. An order becomes a bill when it is PLACED, and
 * that is the line this class draws for everybody.
 */
final class Payable
{
    /**
     * Orders that are a real debt: placed, and not cancelled.
     *
     * @param  Builder<PurchaseOrder>  $query
     * @return Builder<PurchaseOrder>
     */
    public static function billable(Builder $query): Builder
    {
        return $query->whereNotIn('status', [
            PurchaseStatus::Cancelled->value,
            PurchaseStatus::Draft->value,
        ]);
    }

    /**
     * The orders one payment can be applied to, oldest first.
     *
     * Oldest-first is not an arbitrary tiebreak: it is how a shop and a
     * wholesaler both keep the account in their heads, and it is the order in
     * which a supplier chases. `po_number` settles same-day orders so the
     * allocation is deterministic and a replay lands identically.
     *
     * @return Builder<PurchaseOrder>
     */
    public static function openOrdersFor(string $supplierId): Builder
    {
        return self::billable(PurchaseOrder::query())
            ->where('supplier_id', $supplierId)
            ->whereColumn('amount_paid', '<', 'total')
            ->orderBy('order_date')
            ->orderBy('po_number');
    }
}
