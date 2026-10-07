<?php

namespace App\Support;

use App\Models\FuelTank;
use App\Models\Product;
use App\Services\InventoryService;

/**
 * FUEL ON THE SHELF IS WHAT THE DIPS SAY.
 *
 * A shift close has always ended by setting each fuel's stock to the sum of
 * its tanks' closing dips — the ground is the truth and the shelf follows it.
 * Installing a tank did not. A station set its forecourt up, typed "6,000
 * litres" as the tank's current dip, and the shelf went on reading nought:
 * the till called its own diesel out of stock on the first morning, and a
 * tanker's cost was blended against an empty tank that was a fifth full.
 * Nothing put it right until the first shift closed.
 *
 * So the same sentence is said wherever a dip is WRITTEN outside a shift:
 * when a tank is installed, and when its dip is corrected by hand.
 */
final class FuelInTheGround
{
    /**
     * Set a fuel's stock at a branch to the sum of its tanks' dips there.
     *
     * A fuel the station does not stock-track is left alone — it has no shelf
     * figure to be wrong.
     */
    public static function settle(?string $productId, ?string $branchId, string $reason, string $referenceId): void
    {
        if ($productId === null) {
            return;
        }

        $product = Product::query()->whereKey($productId)->first();
        if ($product === null || ! $product->track_inventory) {
            return;
        }

        $inTheGround = (float) FuelTank::query()
            ->where('product_id', $productId)
            ->where('branch_id', $branchId)
            ->where('is_active', true)
            ->sum('current_dip_litres');

        app(InventoryService::class)->adjust([
            'product_id' => $productId,
            'type' => 'set',
            'new_quantity' => round($inTheGround, 3),
            'reason' => $reason,
            'reference_type' => 'fuel_tank',
            'reference_id' => $referenceId,
            'branch_id' => $branchId,
        ]);
    }
}
