<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use App\Support\ItemTypes;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Creates a catalog Item with optional variants + collections — atomically.
 *
 * The item's `item_type` drives its capabilities: the coarse product|service
 * `type` and the default stock-tracking behaviour are derived from it (an
 * explicit track_inventory flag always wins for types that can hold stock).
 *
 * Edge case "price less than cost": allowed (clearance sales are real) but
 * surfaced as a warning the UI must show.
 */
class CreateProductAction
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @return array{product: Product, warnings: string[]}
     */
    public function execute(array $data): array
    {
        $warnings = [];

        // Plan ceiling: block a new catalog item once the shop is at its
        // products limit (no-op for unlimited plans / unprovisioned tenants).
        if (($tenant = $this->context->get()) !== null) {
            PlanLimits::assert($tenant, 'products');
        }

        $product = DB::transaction(function () use ($data): Product {
            $itemType = $data['item_type'] ?? ItemTypes::PHYSICAL;
            $coarse = ItemTypes::coarse($itemType); // product | service
            $canTrack = ItemTypes::canTrackInventory($itemType);
            // Types that can hold stock default per their profile (physical /
            // medicine = on, food = off); an explicit flag overrides.
            $tracksStock = $canTrack
                && ($data['track_inventory'] ?? ItemTypes::defaultTracksInventory($itemType));

            $product = Product::query()->create([
                'type' => $coarse,
                'item_type' => $itemType,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'category_id' => $data['category_id'] ?? null,
                'sku' => $data['sku'] ?? null,
                'barcode' => $data['barcode'] ?? null,
                'plu_code' => $data['plu_code'] ?? null,
                'brand' => $data['brand'] ?? null,
                'generic_name' => $data['generic_name'] ?? null,
                'requires_prescription' => $data['requires_prescription'] ?? false,
                'tracks_serial' => $data['tracks_serial'] ?? false,
                'warranty_months' => $data['warranty_months'] ?? null,
                'unit' => $data['unit'] ?? null,
                'sold_by' => $data['sold_by'] ?? 'unit',
                'attributes' => $data['attributes'] ?? null,
                'price' => $data['price'],
                'cost' => $data['cost'] ?? null,
                'discount_price' => $data['discount_price'] ?? null,
                'wholesale_price' => $data['wholesale_price'] ?? null,
                'price_tiers' => $data['price_tiers'] ?? null,
                'min_order_qty' => $data['min_order_qty'] ?? null,
                'tax_rate' => $data['tax_rate'] ?? null,
                'stock_quantity' => $tracksStock ? ($data['stock_quantity'] ?? 0) : 0,
                'low_stock_threshold' => $tracksStock ? ($data['low_stock_threshold'] ?? null) : null,
                'track_inventory' => $tracksStock,
                'duration_minutes' => $data['duration_minutes'] ?? null,
                'available_from' => $data['available_from'] ?? null,
                'available_until' => $data['available_until'] ?? null,
                'is_active' => $data['is_active'] ?? true,
                'visible_in_marketplace' => $data['visible_in_marketplace'] ?? true,
            ]);

            // Multi-branch: opening stock lands at the tenant's default "Main"
            // branch. branch_stock is the per-branch source of truth;
            // product.stock_quantity (set above) is its sum-across-branches
            // rollup — so the product-level Main row mirrors it exactly.
            $mainBranchId = \App\Models\Branch::withoutTenancy()
                ->where('tenant_id', $product->tenant_id)->where('is_default', true)->value('id');
            \App\Models\BranchStock::withoutTenancy()->create([
                'tenant_id' => $product->tenant_id,
                'branch_id' => $mainBranchId,
                'product_id' => $product->id,
                'variant_id' => null,
                'quantity' => $product->stock_quantity,
            ]);

            // Pharmacy: opening stock must be backed by a lot from day one so
            // stock_quantity and batch totals never start out of step (the
            // rest of the batch loop — PO receipts, returns, FEFO — keeps them
            // aligned). Expiry is left blank for the pharmacist to fill in via
            // the Batches screen. No stock movement here: the opening quantity
            // is already on the product, the batch just records its lot.
            $openingStock = (float) ($tracksStock ? ($data['stock_quantity'] ?? 0) : 0);
            if ($itemType === ItemTypes::MEDICINE && $openingStock > 0) {
                $product->batches()->create([
                    'tenant_id' => $product->tenant_id,
                    'branch_id' => $mainBranchId,
                    'batch_number' => 'OPENING',
                    'expiry_date' => $data['expiry_date'] ?? null,
                    'quantity' => $openingStock,
                    'cost' => $data['cost'] ?? null,
                ]);
            }

            foreach ($data['variants'] ?? [] as $variant) {
                $created = $product->variants()->create([
                    'tenant_id' => $product->tenant_id,
                    'name' => $variant['name'],
                    'sku' => $variant['sku'] ?? null,
                    'price' => $variant['price'],
                    'cost' => $variant['cost'] ?? null,
                    'stock_quantity' => $variant['stock_quantity'] ?? 0,
                    'low_stock_threshold' => $variant['low_stock_threshold'] ?? null,
                ]);

                // Per-branch on-hand for this variant at Main (mirrors the
                // variant's rollup stock_quantity).
                \App\Models\BranchStock::withoutTenancy()->create([
                    'tenant_id' => $product->tenant_id,
                    'branch_id' => $mainBranchId,
                    'product_id' => $product->id,
                    'variant_id' => $created->id,
                    'quantity' => $created->stock_quantity,
                ]);

                // Medicine variants get the same day-one lot guarantee as the
                // product-level opening stock below: every unit is batch-backed
                // so FEFO and the expired fence see it. The opening expiry
                // (required by StoreProductRequest) dates every opening lot; the
                // pharmacist can refine per-lot later on the Batches screen.
                $variantOpening = (float) ($variant['stock_quantity'] ?? 0);
                if ($itemType === ItemTypes::MEDICINE && $variantOpening > 0) {
                    $product->batches()->create([
                        'tenant_id' => $product->tenant_id,
                        'branch_id' => $mainBranchId,
                        'variant_id' => $created->id,
                        'batch_number' => 'OPENING',
                        'expiry_date' => $data['expiry_date'] ?? null,
                        'quantity' => $variantOpening,
                        'cost' => $variant['cost'] ?? null,
                    ]);
                }
            }

            if (! empty($data['collection_ids'])) {
                $product->collections()->sync($data['collection_ids']);
            }

            if (! empty($data['barcodes'])) {
                app(SyncProductBarcodesAction::class)->execute($product, $data['barcodes']);
            }

            if (! empty($data['units'])) {
                app(SyncProductUnitsAction::class)->execute($product, $data['units']);
            }

            if (! empty($data['combo_items'])) {
                app(SyncComboItemsAction::class)->execute($product, $data['combo_items']);
            }

            if (! empty($data['recipe_items'])) {
                app(SyncRecipeItemsAction::class)->execute($product, $data['recipe_items']);
            }

            return $product;
        });

        if (isset($data['cost']) && $data['cost'] !== null && (float) $data['price'] < (float) $data['cost']) {
            $warnings[] = 'Selling price is below cost — this item sells at a loss.';
        }

        foreach ($data['variants'] ?? [] as $variant) {
            if (isset($variant['cost']) && (float) $variant['price'] < (float) $variant['cost']) {
                $warnings[] = "Variant \"{$variant['name']}\" sells below cost.";
            }
        }

        return [
            'product' => $product->load('category', 'variants', 'images', 'collections', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'),
            'warnings' => $warnings,
        ];
    }
}
