<?php

namespace App\Http\Requests\Catalog;

use App\Models\Product;
use App\Support\ItemTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Item type is immutable after creation (a product never becomes a service).
 * Stock is NOT editable here — stock changes go through the Inventory module
 * (Step 8) so every movement has an audit trail.
 */
class UpdateProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $productId = $this->route('product');

        return [
            'type' => ['prohibited'],
            'item_type' => ['prohibited'],
            'stock_quantity' => ['prohibited'],
            'track_inventory' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'category_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'sku' => [
                'nullable', 'string', 'max:64',
                Rule::unique('products', 'sku')->where('tenant_id', $tenantId)->ignore($productId)->whereNull('deleted_at'),
                Rule::unique('product_variants', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'barcode' => [
                'nullable', 'string', 'max:191',
                Rule::unique('products', 'barcode')->where('tenant_id', $tenantId)->ignore($productId)->whereNull('deleted_at'),
            ],
            'plu_code' => [
                'nullable', 'string', 'regex:/^\d{1,7}$/',
                Rule::unique('products', 'plu_code')->where('tenant_id', $tenantId)->ignore($productId)->whereNull('deleted_at'),
            ],
            'brand' => ['nullable', 'string', 'max:120'],
            'generic_name' => ['nullable', 'string', 'max:255'],
            'strength' => ['nullable', 'string', 'max:60'],
            'dosage_form' => ['nullable', 'string', 'max:40'],
            'requires_prescription' => ['sometimes', 'boolean'],
            // The regulator's schedule (G / H / X …). Set it and the till starts
            // demanding prescriber details before the drug can be sold.
            'drug_schedule' => ['sometimes', 'nullable', 'string', 'max:20'],
            // Where this item is MADE: "Kitchen", "Bar", "Grill". A fired
            // order splits into one ticket per station, so the bar never gets
            // the biryani — FireKitchenTicketAction has read this column since
            // the food service loop shipped, and no request validated it, so
            // there was no way to set it and every dish went to the default
            // station.
            'kitchen_station' => ['sometimes', 'nullable', 'string', 'max:60'],
            // Serialized retail — toggle serial/IMEI capture and default warranty.
            'tracks_serial' => ['sometimes', 'boolean'],
            'warranty_months' => ['nullable', 'integer', 'min:0', 'max:600'],
            'barcodes' => ['sometimes', 'nullable', 'array', 'max:20'],
            'barcodes.*' => ['string', 'max:191', 'distinct'],
            'units' => ['sometimes', 'nullable', 'array', 'max:10'],
            'units.*.name' => ['required_with:units', 'string', 'max:60'],
            'units.*.factor' => ['required_with:units', 'numeric', 'min:0.001'],
            'units.*.price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'units.*.barcode' => ['nullable', 'string', 'max:191'],
            'combo_items' => ['sometimes', 'nullable', 'array', 'max:30'],
            // One row per component (see StoreProductRequest) — duplicates lose
            // stock on cancel/return via colliding restore keys.
            'combo_items.*.component_product_id' => ['required_with:combo_items', 'uuid', 'distinct'],
            'combo_items.*.quantity' => ['required_with:combo_items', 'numeric', 'min:0.001'],
            'recipe_items' => ['sometimes', 'nullable', 'array', 'max:60'],
            'recipe_items.*.ingredient_product_id' => ['required_with:recipe_items', 'uuid', 'distinct'],
            'recipe_items.*.quantity' => ['required_with:recipe_items', 'numeric', 'min:0.001'],
            'unit' => ['nullable', 'string', 'max:32'],

            /**
             * Sizes, on an item that already exists.
             *
             * This key was ABSENT, and the way it failed is the reason it is
             * worth a note: `ProductController::update` passes
             * `$request->validated()`, which returns only rule-covered keys — so
             * `PUT /products/{id}` carrying a `variants` array answered
             * **200 "Item updated"** and discarded every one of them. A success
             * response for work that was thrown away, which is worse than a
             * refusal, because nobody goes looking.
             *
             * `id` is what distinguishes an edit from an addition: a row with one
             * updates that variant, a row without creates one, and a variant
             * whose id stops appearing is retired. `SyncProductVariantsAction`
             * does the reconciling.
             *
             * `stock_quantity` is accepted only on a NEW row. Stock has one write
             * path (InventoryService) so every unit lands in `stock_movements`;
             * an edit form that could set a quantity would be a second, silent
             * door onto the shelf.
             */
            'variants' => ['sometimes', 'nullable', 'array', 'max:100'],
            'variants.*.id' => ['nullable', 'uuid'],
            'variants.*.name' => ['required_with:variants', 'string', 'max:100', 'distinct'],
            'variants.*.sku' => [
                'nullable', 'string', 'max:64', 'distinct',
                // `route('product')` is the ID STRING, not a bound model — this
                // controller does its own `findOrFail`. Written as
                // `?->id` first, which threw "Attempt to read property id on
                // string" and 500'd every update. Same shape as reading an
                // attribute a model does not have, one layer out.
                //
                // Ignoring this product's own rows is the point: a variant
                // keeping the SKU it already has is not a collision.
                Rule::unique('product_variants', 'sku')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at')
                    ->ignore($this->route('product'), 'product_id'),
                Rule::unique('products', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // The code printed on THIS size's packet. A drinks shop's 500ml and
            // 1L carry different EANs; uniqueness across every namespace a scan
            // consults is enforced in BarcodeNamespace, not here, because a
            // validation rule cannot see the variant it is being assigned to.
            'variants.*.barcode' => ['nullable', 'string', 'max:64', 'distinct'],
            'variants.*.price' => ['required_with:variants', 'numeric', 'min:0'],
            'variants.*.cost' => ['nullable', 'numeric', 'min:0'],
            'variants.*.stock_quantity' => ['sometimes', 'numeric', 'min:0'],
            'variants.*.low_stock_threshold' => ['nullable', 'numeric', 'min:0'],
            'variants.*.is_active' => ['sometimes', 'boolean'],

            // ── Sizes, and the axes they were generated from ─────────────
            //
            // `variants` is the flat list the rest of the system reads. The AXES
            // are what a shopkeeper actually typed — Colour: Red, Blue / Size: S,
            // M, L — and they are kept so the matrix can be reopened on edit
            // rather than presenting twelve unexplained rows. Stored inside the
            // product's existing `attributes` JSON, so no migration and no new
            // column; accepted at the top level here because `attributes.*` is
            // rules as a flat string bag and a nested array would fail it.
            'variant_axes' => ['sometimes', 'nullable', 'array', 'max:3'],
            'variant_axes.*.name' => ['required_with:variant_axes', 'string', 'max:40'],
            'variant_axes.*.values' => ['required_with:variant_axes', 'array', 'min:1', 'max:40'],
            'variant_axes.*.values.*' => ['string', 'max:60'],

            'attributes' => ['nullable', 'array'],
            'attributes.*' => ['nullable', 'string', 'max:255'],
            'price' => ['sometimes', 'required', 'numeric', 'min:0', 'max:99999999'],
            'cost' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'discount_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'wholesale_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'price_tiers' => ['nullable', 'array', 'max:10'],
            'price_tiers.*.min_qty' => ['required_with:price_tiers', 'numeric', 'min:0.001'],
            'price_tiers.*.price' => ['required_with:price_tiers', 'numeric', 'min:0.01'],
            'min_order_qty' => ['nullable', 'numeric', 'min:0.001'],
            'sold_by' => ['sometimes', 'in:unit,weight'],
            'tax_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'tax_group_id' => [
                'nullable', 'uuid',
                Rule::exists('tax_groups', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'collection_ids' => ['nullable', 'array'],
            'collection_ids.*' => [
                'uuid',
                Rule::exists('collections', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'low_stock_threshold' => ['nullable', 'numeric', 'min:0'],
            'duration_minutes' => ['nullable', 'integer', 'min:1', 'max:1440'],
            // Both ends of the window or neither — half a window would
            // silently mean "always available".
            'available_from' => ['nullable', 'required_with:available_until', 'date_format:H:i,H:i:s'],
            'available_until' => ['nullable', 'required_with:available_from', 'date_format:H:i,H:i:s'],
            'is_active' => ['sometimes', 'boolean'],
            'visible_in_marketplace' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * Type-capability gating on UPDATE mirrors create: duration stays
     * service-only and combo contents stay deal-only — the item's type is
     * fixed, so these can't leak across types via PUT either.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            $product = Product::query()->find($this->route('product'));
            if ($product === null) {
                return; // 404s in the controller
            }

            if ($this->filled('duration_minutes') && $product->type->value !== 'service') {
                $v->errors()->add('duration_minutes', 'Only services have a duration.');
            }

            if ($this->filled('combo_items') && ! $product->isCombo()) {
                $v->errors()->add('combo_items', 'Only a deal bundles other products.');
            }

            if ($this->filled('recipe_items') && $product->item_type !== ItemTypes::FOOD) {
                $v->errors()->add('recipe_items', 'Only a food dish can have a recipe of ingredients.');
            }

            StoreProductRequest::validatePriceTiers($v, $this->input('price_tiers'));
        });
    }

    public function messages(): array
    {
        return [
            'type.prohibited' => 'Item type cannot be changed after creation.',
            'item_type.prohibited' => 'Item type cannot be changed after creation.',
            'stock_quantity.prohibited' => 'Stock changes go through inventory adjustments.',
            'sku.unique' => 'This SKU is already used by another item.',
            'barcode.unique' => 'This barcode is already used by another item.',
        ];
    }
}
