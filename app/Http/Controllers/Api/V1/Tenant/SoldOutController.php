<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * "Eighty-six the fish" — and put it back on when the delivery lands.
 *
 * ── Why this is not the product form ────────────────────────────────────
 *
 * Deactivating a product is a catalog decision: it leaves the storefront, the
 * menu and the reports, and somebody makes it once. This is a SERVICE
 * decision — made in the middle of a shift, by whoever is cooking, about
 * tonight — and it gets undone tomorrow morning.
 *
 * Putting it behind the product editor would mean a chef opening a form with
 * thirty fields on it to change one, twice a day, and would leave a dish
 * deactivated for a month because nobody went back.
 *
 * ── Who may ─────────────────────────────────────────────────────────────
 *
 * `products.manage`, not `sales.manage`. A cashier ringing a queue must not be
 * able to take a dish off the menu with a mis-tap, and the people who do this
 * — head chef, floor manager, owner — already hold it.
 */
class SoldOutController extends Controller
{
    /**
     * ONE SIZE, off tonight.
     *
     * A pizzeria runs out of large bases, not of pizza. Before this the only
     * move was to take the whole item off, so Small and Medium went with it —
     * all evening, on the busiest thing on the menu.
     *
     * The product-level flag stays exactly as it was: "no pizza tonight" is
     * still a sentence a shop needs to be able to say, and it is not the same
     * sentence as "no large".
     */
    public function storeVariant(Product $product, ProductVariant $variant): JsonResponse
    {
        $this->mustBelong($product, $variant);

        if ($variant->sold_out_at === null) {
            $variant->forceFill([
                'sold_out_at' => now(),
                'sold_out_by' => auth()->id(),
            ])->save();
        }

        return ApiResponse::ok(
            ['id' => $variant->id, 'sold_out_at' => $variant->sold_out_at],
            "{$product->name} — {$variant->name} is off the menu.",
        );
    }

    /** Put that size back. */
    public function destroyVariant(Product $product, ProductVariant $variant): JsonResponse
    {
        $this->mustBelong($product, $variant);

        $variant->forceFill(['sold_out_at' => null, 'sold_out_by' => null])->save();

        return ApiResponse::ok(
            ['id' => $variant->id, 'sold_out_at' => null],
            "{$product->name} — {$variant->name} is back on.",
        );
    }

    /**
     * The size has to be this product's.
     *
     * Route model binding resolves both independently, so without this a shop
     * could 86 somebody else's size through a URL — and the reply would name
     * this product while the flag landed on another.
     */
    private function mustBelong(Product $product, ProductVariant $variant): void
    {
        abort_if($variant->product_id !== $product->id, 404);
    }

    /** Take it off. Idempotent: 86'ing an already-86'd dish keeps the first time. */
    public function store(Product $product): JsonResponse
    {
        // The FIRST timestamp is the useful one. Re-stamping on every press
        // would erase "off since Tuesday", which is the whole point of storing
        // a time rather than a flag — a dish nobody remembers turning off is
        // what this feature costs a shop if it cannot say how long.
        if ($product->sold_out_at === null) {
            $product->forceFill([
                'sold_out_at' => now(),
                'sold_out_by' => auth()->id(),
            ])->save();
        }

        return ApiResponse::ok(
            ['id' => $product->id, 'sold_out_at' => $product->sold_out_at],
            "{$product->name} is off the menu.",
        );
    }

    /** Put it back. */
    public function destroy(Product $product): JsonResponse
    {
        $product->forceFill(['sold_out_at' => null, 'sold_out_by' => null])->save();

        return ApiResponse::ok(
            ['id' => $product->id, 'sold_out_at' => null],
            "{$product->name} is back on.",
        );
    }
}
