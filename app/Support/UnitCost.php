<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductVariant;

/**
 * WHAT ONE OF THESE COST THE SHOP — a size's own cost, or its design's.
 *
 * A design is carded once: one name, one cost, and then a grid of sizes with
 * a price, a tag and a count each. The form asks what the DESIGN cost, and a
 * size has a cost of its own only when a purchase order received it at one.
 *
 * The stock report has always read it that way —
 * `COALESCE(product_variants.cost, products.cost)` — and so has a write-off.
 * The three places that sell did not: they took "the size, or else the
 * design" as the thing bought and read ITS cost, so a size with none of its
 * own was sold at a cost of nothing. Every sized item in a clothing shop, and
 * every drink that comes in Small and Large, was pure profit on the reports:
 * a kurta carded at Rs 1,600 and sold at Rs 2,950 showed Rs 2,950 made.
 *
 * Found by selling one, in a shop made by hand, and asking the server what
 * the line had cost. One rule now, here, and all four ask it.
 */
final class UnitCost
{
    /** Per base unit. Null when neither the size nor the design has ever been given a cost. */
    public static function of(Product $product, ?ProductVariant $variant = null): ?float
    {
        $cost = $variant?->cost ?? $product->cost;

        return $cost === null ? null : (float) $cost;
    }

    /** The same, for a pack of `$factor` base units, to the paisa — what a sale line records. */
    public static function ofPack(Product $product, ?ProductVariant $variant, float $factor): ?float
    {
        $each = self::of($product, $variant);

        return $each === null ? null : round($each * $factor, 2);
    }
}
