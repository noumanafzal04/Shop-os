<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\FuelTank;

/**
 * FUEL IN A TANK COMES IN BY TANKER, WITH THE DIPS — NEVER ON A PURCHASE ORDER.
 *
 * A tanker delivery (Fuel → Deliveries) records the dip before and after, the
 * tank it went into and who received it; that is the only proof a forecourt
 * has that the litres it paid for are the litres it holds. A purchase-order
 * receipt raised stock with none of that: tester pass 2 (B41) took 1,000 L of
 * petrol into stock through a PO as the forecourt attendant, who is refused a
 * tanker delivery. The owner (2026-10-14): fuel only by tanker, for everyone.
 *
 * Lubricants, filters and the shop's other goods are not in a tank and are
 * bought on a purchase order like anything else.
 */
final class TankFuel
{
    /** @param  list<string>  $productIds */
    public static function refuse(array $productIds): void
    {
        $fuel = FuelTank::query()
            ->whereIn('product_id', array_values(array_unique($productIds)))
            ->with('product:id,name')
            ->get()
            ->pluck('product.name')
            ->unique()
            ->values();

        if ($fuel->isNotEmpty()) {
            throw DomainException::unprocessable(
                $fuel->implode(', ').' is kept in a tank — take it in from Fuel → Deliveries, with the dips, not on a purchase order.',
                'FUEL_COMES_BY_TANKER',
            );
        }
    }
}
