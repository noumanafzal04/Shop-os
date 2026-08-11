<?php

namespace App\Models\Concerns;

use App\Models\User;
use App\Support\Permissions;

/**
 * Strips what the shop PAID from the serialised payload of anyone not entitled
 * to it.
 *
 * Guarded on the MODEL rather than in a controller because a product is
 * serialised from a dozen places — the catalog grid, POS lookup, global search,
 * a sale line's eager-loaded relation, a purchase order's item — and a rule
 * enforced at one of them is a rule that leaks from the other eleven. The
 * margin REPORT was already shut to a cashier; `cost` on a product row is the
 * same figure arriving by the back door.
 *
 * Only `cost` is stripped. `wholesale_price` is a SELLING price and stays:
 * the POS reads it to offer the wholesale price level (`levelBase` in
 * PosPage), so hiding it from a cashier would not protect anything — it would
 * silently remove wholesale selling from the till.
 *
 * Attribute access (`$product->cost`) is untouched, so every internal caller —
 * costing a sale line, valuing a shelf, the CSV export behind its own
 * permission — keeps working. Only the serialised payload changes.
 */
trait HidesCostPrice
{
    public function toArray(): array
    {
        $data = parent::toArray();

        // No authenticated user means an internal caller (a queue job, a
        // console command, a test asserting on the model itself). Those are
        // not the leak; the leak is an HTTP read by a person.
        $user = auth()->user();

        if ($user instanceof User && ! $user->hasAnyPermission(Permissions::READS_COST)) {
            unset($data['cost']);
        }

        return $data;
    }
}
