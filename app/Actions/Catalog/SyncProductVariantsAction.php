<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Support\BarcodeNamespace;
use App\Support\ItemTypes;
use Illuminate\Support\Facades\DB;

/**
 * The sizes of a product, after it exists.
 *
 * Until this class there was no way to change a variant at all. Not a hard way —
 * none: no route (`grep variant routes/` returned nothing), no rules in
 * `UpdateProductRequest`, and the panel hid the whole section on edit. A shop
 * that mis-priced its Large lived with it, and `PUT /products/{id}` carrying a
 * `variants` array answered **200 "Item updated"** while `validated()` dropped
 * every one of them — a success response for discarded work, which is worse than
 * a refusal.
 *
 * Follows the `Sync*` shape its five siblings already use (barcodes, units,
 * combo items, recipe items, modifier groups): given the whole desired list,
 * make the database match it.
 *
 * ── THREE THINGS THIS MUST GET RIGHT ────────────────────────────────────
 *
 * **1. It must touch the parent.** The offline catalog is delivered as a delta
 * keyed on `products.updated_at|products.id` (`PosDelta::page`), and variants
 * ride inside the product's projection as eager-loaded children. Nothing
 * anywhere compares `product_variants.updated_at`. So a variant change that does
 * not move the PARENT's timestamp never reaches a till — and the failure is not
 * "the till is a bit stale":
 *
 *     retire a size → the server refuses it (CreateSaleAction) → the till never
 *     hears → it keeps selling it → every one of those queued sales dies on sync
 *     with VARIANT_UNAVAILABLE, non-retryable, after the cash was taken.
 *
 * `CreateSaleAction` gates that check on `trusted`, and an offline-queued sale is
 * deliberately NOT trusted, so nothing downstream spares them. The `touch()`
 * below is the only thing standing between an edit and that outcome.
 *
 * **2. It must never force-delete.** Five tables CASCADE off a variant —
 * including `stock_movements`, which is the entire stock audit trail — and three
 * more (`ticket_items`, `product_serials`, `sale_item_serials`) carry a
 * `variant_id` with no foreign key at all, so they would simply dangle. A soft
 * delete fires none of that, which is why `ProductController::destroy` already
 * uses one. Removing a size here means soft-deleting it; the sold lines keep
 * their `variant_name` snapshot and their link.
 *
 * **3. A varianted product must keep at least one sellable size.** A varianted
 * product holds no stock of its own — `Product::effectiveStock()` calls the
 * parent figure "an orphaned leftover that must not be read as truth" — so a
 * product whose every size is gone or switched off renders as a live, in-stock,
 * unbuyable tile. That exact shape has already been fixed once from the other
 * direction, and this refuses to create it.
 */
class SyncProductVariantsAction
{
    /**
     * @param  array<int, array<string, mixed>>  $variants  the whole desired list
     */
    public function execute(Product $product, array $variants): void
    {
        DB::transaction(function () use ($product, $variants): void {
            $existing = $product->variants()->get()->keyBy('id');
            // The shop's default branch, resolved the same way CreateProductAction
            // resolves it. A new size has to arrive on the same shelf the product
            // itself was put on.
            $mainBranchId = Branch::withoutTenancy()
                ->where('tenant_id', $product->tenant_id)
                ->where('is_default', true)
                ->value('id');

            $kept = [];
            $anyActive = false;

            foreach ($variants as $row) {
                $id = $row['id'] ?? null;
                $active = ! array_key_exists('is_active', $row) || (bool) $row['is_active'];
                $anyActive = $anyActive || $active;

                $fields = [
                    'name' => $row['name'],
                    'sku' => $row['sku'] ?? null,
                    'price' => $row['price'],
                    'cost' => $row['cost'] ?? null,
                    'low_stock_threshold' => $row['low_stock_threshold'] ?? null,
                    'is_active' => $active,
                ];

                if ($id !== null && $existing->has($id)) {
                    /** @var ProductVariant $variant */
                    $variant = $existing->get($id);

                    // `stock_quantity` is DELIBERATELY not editable here.
                    //
                    // Stock has one write path — InventoryService — so that every
                    // unit is accounted for in `stock_movements`. Letting an edit
                    // form set a quantity directly would put a second, silent
                    // door on the shelf, and the difference between the two would
                    // be invisible until somebody counted.
                    $variant->fill($fields)->save();
                    BarcodeNamespace::assign($product, $variant, $row);
                    $kept[] = $variant->id;

                    continue;
                }

                $created = $product->variants()->create([
                    'tenant_id' => $product->tenant_id,
                    ...$fields,
                    'stock_quantity' => $row['stock_quantity'] ?? 0,
                ]);
                $kept[] = $created->id;

                BarcodeNamespace::assign($product, $created, $row);
                $this->openTheShelfFor($product, $created, $mainBranchId, $row);
            }

            $removed = $existing->keys()->diff($kept);

            // The guard, applied to what the list WOULD leave behind.
            if ($variants !== [] && ! $anyActive) {
                throw new DomainException(
                    'A product with sizes needs at least one that is still for sale. '
                    .'Switch another size on first, or retire the whole item instead.',
                    422,
                    'NO_SELLABLE_VARIANT',
                );
            }

            if ($removed->isNotEmpty()) {
                // Soft, never forced — see the note above.
                ProductVariant::query()->whereIn('id', $removed->all())->delete();
            }

            // ── the line the offline till depends on ────────────────────
            //
            // `save()` on an unchanged model is a no-op, so a variant-only edit
            // moves no product column and would leave the delta cursor exactly
            // where it was. `touch()` is unconditional and deliberate.
            $product->touch();
        });
    }

    /**
     * A new size arrives with a shelf to sit on, and a lot if it needs one.
     *
     * `CreateProductAction` does both of these when a product is first made, and
     * a variant added later has to arrive in the same state — otherwise it has no
     * `branch_stocks` row (which is the per-branch source of truth, so the till
     * reads zero for something that is really there) and, if it is a medicine, no
     * batch (which puts it outside FEFO and outside the expired fence).
     *
     * @param  array<string, mixed>  $row
     */
    private function openTheShelfFor(Product $product, ProductVariant $variant, ?string $branchId, array $row): void
    {
        if ($branchId === null) {
            return;
        }

        BranchStock::withoutTenancy()->create([
            'tenant_id' => $product->tenant_id,
            'branch_id' => $branchId,
            'product_id' => $product->id,
            'variant_id' => $variant->id,
            'quantity' => $variant->stock_quantity,
        ]);

        $opening = (float) ($row['stock_quantity'] ?? 0);
        if ($product->item_type === ItemTypes::MEDICINE && $opening > 0) {
            $product->batches()->create([
                'tenant_id' => $product->tenant_id,
                'branch_id' => $branchId,
                'variant_id' => $variant->id,
                // A size added later has no "opening batch" of its own to borrow,
                // and inventing an expiry would be a guess dressed as a date. The
                // pharmacist dates it on the Batches screen; until then it is an
                // undated lot, which FEFO already sorts last.
                'batch_number' => 'ADDED-'.strtoupper(substr($variant->id, -6)),
                'expiry_date' => null,
                'quantity' => $opening,
                'cost' => $row['cost'] ?? null,
            ]);
        }
    }
}
