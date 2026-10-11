<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;

/**
 * WHERE A NEW ITEM'S OPENING STOCK IS PUT: where its maker is standing.
 *
 * It used to go on Main, always. That was true when a shop had one place, and
 * stayed in the code after it stopped being true: an owner who chose the
 * godown at the top of the screen and carded forty new lines with their
 * quantities — or imported a sheet of them — had every one of them land on the
 * shop's shelf, while the screen in front of them said they were in the
 * godown. The hand adjustment had this same fault and was mended; the item
 * form was the same question asked through another door.
 *
 * One answer for both writers of opening stock — a product being made, and a
 * size added to one later — because two resolvers of "which shelf" is how they
 * came to disagree in the first place.
 *
 * ── Why Main always gets a row too ──────────────────────────────────────
 *
 * `InventoryService` reads a product with NO row at Main as stock that
 * pre-dates per-place rows, and seeds Main from the product's total. A
 * product whose sixty units were put in the godown would then be read as
 * having sixty at Main as well, the first time either shelf was touched. An
 * explicit nought at Main says "it holds none" and stops that.
 */
final class OpeningShelf
{
    /** The place being stood in, when it is this business's; otherwise its Main. */
    public static function placeFor(string $tenantId): ?string
    {
        $standing = app(BranchContext::class)->get();
        if ($standing !== null && $standing->tenant_id === $tenantId) {
            return $standing->id;
        }

        return self::mainOf($tenantId);
    }

    /**
     * Put an opening quantity on that shelf. Returns the place, so a lot opened
     * for the same stock can be put in the same one.
     */
    public static function open(Product $product, ?string $variantId, float $quantity): ?string
    {
        $place = self::placeFor($product->tenant_id);
        if ($place === null) {
            return null;
        }

        $shelf = fn (string $branchId, float $held) => BranchStock::withoutTenancy()->create([
            'tenant_id' => $product->tenant_id,
            'branch_id' => $branchId,
            'product_id' => $product->id,
            'variant_id' => $variantId,
            'quantity' => $held,
        ]);

        $shelf($place, $quantity);

        $main = self::mainOf($product->tenant_id);
        if ($main !== null && $main !== $place) {
            $shelf($main, 0.0);
        }

        return $place;
    }

    private static function mainOf(string $tenantId): ?string
    {
        return Branch::withoutTenancy()->where('tenant_id', $tenantId)->where('is_default', true)->value('id');
    }
}
