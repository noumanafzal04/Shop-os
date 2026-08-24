<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\BranchSoldOut;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\ApiResponse;
use App\Support\BranchContext;
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

        $row = $this->take($product, $variant);

        return ApiResponse::ok(
            ['id' => $variant->id, 'sold_out_at' => $row->sold_out_at],
            "{$product->name} — {$variant->name} is off the menu at {$this->branchName()}.",
        );
    }

    /** Put that size back. */
    public function destroyVariant(Product $product, ProductVariant $variant): JsonResponse
    {
        $this->mustBelong($product, $variant);

        $this->putBack($product, $variant);

        return ApiResponse::ok(
            ['id' => $variant->id, 'sold_out_at' => null],
            "{$product->name} — {$variant->name} is back on at {$this->branchName()}.",
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

    /** Take it off, HERE. Idempotent: a second press keeps the first time. */
    public function store(Product $product): JsonResponse
    {
        $row = $this->take($product, null);

        return ApiResponse::ok(
            ['id' => $product->id, 'sold_out_at' => $row->sold_out_at],
            "{$product->name} is off the menu at {$this->branchName()}.",
        );
    }

    /** Put it back here. */
    public function destroy(Product $product): JsonResponse
    {
        $this->putBack($product, null);

        return ApiResponse::ok(
            ['id' => $product->id, 'sold_out_at' => null],
            "{$product->name} is back on at {$this->branchName()}.",
        );
    }

    /**
     * WHICH BRANCH is running out.
     *
     * The OPERATING branch (`id()`), never the read scope (`scopeId()`): this
     * is a write, and an owner looking at all branches has a null scope. The
     * same rule receiving a delivery follows, and for the same reason — goods
     * arrive somewhere definite, and so does running out of them.
     */
    private function branchId(): string
    {
        $id = app(BranchContext::class)->id();

        if ($id === null) {
            throw DomainException::unprocessable(
                'Choose which branch has run out before taking something off the menu.',
                'BRANCH_REQUIRED',
            );
        }

        return $id;
    }

    private function branchName(): string
    {
        return Branch::query()->whereKey($this->branchId())->value('name') ?? 'this branch';
    }

    /**
     * The FIRST press is the one that counts.
     *
     * Re-stamping would erase "off since Tuesday", which is the whole point of
     * storing a time rather than a flag: a dish nobody remembers turning off is
     * what this costs a shop if it cannot say how long.
     */
    private function take(Product $product, ?ProductVariant $variant): BranchSoldOut
    {
        return BranchSoldOut::query()->firstOrCreate(
            [
                'branch_id' => $this->branchId(),
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
            ],
            [
                'tenant_id' => $product->tenant_id,
                'sold_out_at' => now(),
                'sold_out_by' => auth()->id(),
            ],
        );
    }

    private function putBack(Product $product, ?ProductVariant $variant): void
    {
        BranchSoldOut::query()
            ->where('branch_id', $this->branchId())
            ->where('product_id', $product->id)
            ->where('variant_id', $variant?->id)
            ->delete();
    }
}
