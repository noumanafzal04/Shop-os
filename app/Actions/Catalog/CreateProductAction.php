<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use App\Support\BarcodeNamespace;
use App\Support\ItemTypes;
use App\Support\OpeningShelf;
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

        $recipeWarnings = [];

        $product = DB::transaction(function () use ($data, &$recipeWarnings): Product {
            $itemType = $data['item_type'] ?? ItemTypes::PHYSICAL;
            $coarse = ItemTypes::coarse($itemType); // product | service
            $canTrack = ItemTypes::canTrackInventory($itemType);

            /**
             * A SHOP THAT DOES NOT COUNT STOCK MAKES PRODUCTS THAT DO NOT
             * CLAIM TO.
             *
             * The item type decides what a thing IS — a physical product can
             * hold stock, a dish cannot. The module decides whether this shop
             * counts any, and until now only the first was asked.
             *
             * That combination is not hypothetical. An Online Store has no
             * inventory module and is offered exactly one item type,
             * `physical_product`, whose profile says stock is required. So
             * every product it created was born tracking stock at a quantity of
             * zero, with no screen anywhere to raise it — and the FIRST ORDER
             * for anything failed with "only 0 in stock". A shop that cannot
             * sell is not a shop.
             *
             * A shop granted inventory later keeps its old products untracked,
             * which is right: they never counted, and inventing a figure for
             * them would be inventing stock.
             *
             * ── And ONLY the default ─────────────────────────────────
             *
             * An explicit `track_inventory: true` still wins, because it is
             * somebody saying so. A restaurant whose inventory module is off
             * may still want to count the frozen kebabs in the chest freezer,
             * and refusing that would be overruling a person with a template.
             * What changes is what happens when NOBODY said anything — and
             * silence should not mean "count stock you have no screen for".
             */
            $countsStock = $this->context->get()?->featureEnabled('inventory') ?? true;

            // Types that can hold stock default per their profile (physical /
            // medicine = on, food = off); an explicit flag overrides.
            $tracksStock = $canTrack
                && ($data['track_inventory'] ?? (ItemTypes::defaultTracksInventory($itemType) && $countsStock));

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
                'strength' => $data['strength'] ?? null,
                'dosage_form' => $data['dosage_form'] ?? null,
                // These three were validated by the request, sent by the form,
                // and then never written: this insert names its columns one by
                // one and these were missing from the list. UpdateProductAction
                // fills the model wholesale, so each one saved fine the SECOND
                // time you pressed save — which is the worst shape a bug can
                // take, because the field looks like it works.
                //
                // `drug_schedule` blanked the controlled-drug marking on every
                // new medicine. `tax_group_id` silently dropped a chosen rate
                // and fell back to the shop default, so the item was PRICED
                // wrong. `kitchen_station` had no writer anywhere at all, while
                // FireKitchenTicketAction has been reading it to route tickets
                // — so every dish went to the default station and the bar got
                // the biryani, which is the exact failure stations prevent.
                'drug_schedule' => $data['drug_schedule'] ?? null,
                'tax_group_id' => $data['tax_group_id'] ?? null,
                'kitchen_station' => $data['kitchen_station'] ?? null,
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
                'for_sale' => $data['for_sale'] ?? true,
                'visible_in_marketplace' => $data['visible_in_marketplace'] ?? true,
            ]);

            // Opening stock lands where its maker is standing — the godown,
            // when the godown is chosen — and on Main otherwise. branch_stock
            // is the per-place source of truth; product.stock_quantity (set
            // above) is its sum across places. See OpeningShelf.
            $placeId = OpeningShelf::open($product, null, (float) $product->stock_quantity);

            // Pharmacy: opening stock must be backed by a lot from day one so
            // stock_quantity and batch totals never start out of step (the
            // rest of the batch loop — PO receipts, returns, FEFO — keeps them
            // aligned). Expiry is left blank for the pharmacist to fill in via
            // the Batches screen. No stock movement here: the opening quantity
            // is already on the product, the batch just records its lot.
            //
            // Anything else that goes off — milk, yogurt, bread — is given a lot
            // when its maker gave one: a batch number or an expiry. Both were
            // accepted and dropped without a word for every item that was not
            // a medicine (tester pass 4, B60), so the first yogurt sold was
            // never the oldest one and the expiring list never named it.
            $openingBatch = trim((string) ($data['opening_batch_number'] ?? '')) ?: 'OPENING';
            $openingStock = (float) ($tracksStock ? ($data['stock_quantity'] ?? 0) : 0);
            $keepsALot = $itemType === ItemTypes::MEDICINE
                || trim((string) ($data['opening_batch_number'] ?? '')) !== ''
                || ! empty($data['expiry_date']);
            if ($keepsALot && $openingStock > 0) {
                $product->batches()->create([
                    'tenant_id' => $product->tenant_id,
                    // The lot is where the stock is.
                    'branch_id' => $placeId,
                    'batch_number' => $openingBatch,
                    'expiry_date' => $data['expiry_date'] ?? null,
                    'quantity' => $openingStock,
                    'cost' => $data['cost'] ?? null,
                ]);
            }

            // The axes those variants were generated from, kept beside them so
            // the matrix can be reopened on edit. See UpdateProductAction.
            if (! empty($data['variant_axes'])) {
                $product->attributes = [...($product->attributes ?? []), 'variant_axes' => $data['variant_axes']];
                $product->save();
            }

            // The place is the position in the list as typed — read by key,
            // because validated rows are not always handed over in key order
            // (see SyncProductVariantsAction).
            $typed = $data['variants'] ?? [];
            ksort($typed);
            foreach (array_values($typed) as $position => $variant) {
                $created = $product->variants()->create([
                    'tenant_id' => $product->tenant_id,
                    'name' => $variant['name'],
                    'sort_order' => $position,
                    'sku' => $variant['sku'] ?? null,
                    'price' => $variant['price'],
                    'cost' => $variant['cost'] ?? null,
                    'stock_quantity' => $variant['stock_quantity'] ?? 0,
                    'low_stock_threshold' => $variant['low_stock_threshold'] ?? null,
                ]);

                // The code printed on THIS size's packet. Written through the
                // same place the edit path uses, because this loop and
                // SyncProductVariantsAction are two writers of one thing and a
                // barcode saved by only one of them exists after an edit and not
                // after a create.
                BarcodeNamespace::assign($product, $created, $variant);

                // This size's on-hand, on the same shelf the product was put on.
                OpeningShelf::open($product, $created->id, (float) $created->stock_quantity);

                // Medicine variants get the same day-one lot guarantee as the
                // product-level opening stock below: every unit is batch-backed
                // so FEFO and the expired fence see it. The opening expiry
                // (required by StoreProductRequest) dates every opening lot; the
                // pharmacist can refine per-lot later on the Batches screen.
                $variantOpening = (float) ($variant['stock_quantity'] ?? 0);
                if ($keepsALot && $variantOpening > 0) {
                    $product->batches()->create([
                        'tenant_id' => $product->tenant_id,
                        'branch_id' => $placeId,
                        'variant_id' => $created->id,
                        'batch_number' => $openingBatch,
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
                // Saving a recipe can switch stock tracking on for an
                // ingredient — the merchant is told which ones.
                $recipeWarnings = app(SyncRecipeItemsAction::class)->execute($product, $data['recipe_items']);
            }

            return $product;
        });

        $warnings = array_merge($warnings, $recipeWarnings);

        if (isset($data['cost']) && $data['cost'] !== null && (float) $data['price'] < (float) $data['cost']) {
            $warnings[] = 'Selling price is below cost — this item sells at a loss.';
        }

        foreach ($data['variants'] ?? [] as $variant) {
            if (isset($variant['cost']) && (float) $variant['price'] < (float) $variant['cost']) {
                $warnings[] = "Variant \"{$variant['name']}\" sells below cost.";
            }
        }

        return [
            'product' => $product->load('category', 'variants', 'images', 'collections', 'units.codes:id,product_unit_id,barcode', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name'),
            'warnings' => $warnings,
        ];
    }
}
