<?php

namespace App\Http\Requests\Catalog;

use App\Support\ItemTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    /**
     * Back-compat: older clients send the coarse `type` (product|service).
     * Map it onto the richer `item_type` when the latter is absent.
     */
    protected function prepareForValidation(): void
    {
        if (! $this->filled('item_type') && $this->filled('type')) {
            $this->merge([
                'item_type' => $this->input('type') === 'service' ? ItemTypes::SERVICE : ItemTypes::PHYSICAL,
            ]);
        }
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $itemType = $this->input('item_type', ItemTypes::PHYSICAL);
        $isService = ItemTypes::coarse(is_string($itemType) ? $itemType : ItemTypes::PHYSICAL) === 'service';

        return [
            'item_type' => ['required', Rule::in(ItemTypes::codes())],
            'type' => ['sometimes'], // legacy, ignored — derived from item_type
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'category_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // Duplicate SKU blocked per tenant (products AND their variants).
            'sku' => [
                'nullable', 'string', 'max:64',
                Rule::unique('products', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
                Rule::unique('product_variants', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'barcode' => [
                'nullable', 'string', 'max:191',
                Rule::unique('products', 'barcode')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // Scale PLU code — the numeric code a weighing scale prints for a
            // loose item. Digits only; unique per tenant so a scan is unambiguous.
            'plu_code' => [
                'nullable', 'string', 'regex:/^\d{1,7}$/',
                Rule::unique('products', 'plu_code')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'brand' => ['nullable', 'string', 'max:120'],
            'generic_name' => ['nullable', 'string', 'max:255'],
            'requires_prescription' => ['sometimes', 'boolean'],
            // Alternate barcodes (mart): uniqueness across primary + extras is
            // enforced in the action (BARCODE_TAKEN), so shared create/update logic.
            'barcodes' => ['nullable', 'array', 'max:20'],
            'barcodes.*' => ['string', 'max:191', 'distinct'],
            // Pack sizes (pack-breaking): each pack maps to a number of base
            // units. factor > 1 is enforced in SyncProductUnitsAction.
            'units' => ['nullable', 'array', 'max:10'],
            'units.*.name' => ['required_with:units', 'string', 'max:60'],
            'units.*.factor' => ['required_with:units', 'numeric', 'min:0.001'],
            'units.*.price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'units.*.barcode' => ['nullable', 'string', 'max:191'],
            // Combo/deal contents (item_type = deal): component products + qty.
            'combo_items' => ['nullable', 'array', 'max:30'],
            'combo_items.*.component_product_id' => ['required_with:combo_items', 'uuid'],
            'combo_items.*.quantity' => ['required_with:combo_items', 'numeric', 'min:0.001'],
            'unit' => ['nullable', 'string', 'max:32'],
            'attributes' => ['nullable', 'array'],
            'attributes.*' => ['nullable', 'string', 'max:255'],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'cost' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'discount_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'wholesale_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'price_tiers' => ['nullable', 'array', 'max:10'],
            'price_tiers.*.min_qty' => ['required_with:price_tiers', 'numeric', 'min:0.001'],
            'price_tiers.*.price' => ['required_with:price_tiers', 'numeric', 'min:0.01'],
            'min_order_qty' => ['nullable', 'numeric', 'min:0.001'],
            'sold_by' => ['sometimes', 'in:unit,weight'],
            'tax_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],

            // Collections — attach to any number of the tenant's collections.
            'collection_ids' => ['nullable', 'array'],
            'collection_ids.*' => [
                'uuid',
                Rule::exists('collections', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],

            // Stock fields — prohibited for non-inventory (service) types
            'track_inventory' => [$isService ? 'prohibited' : 'sometimes', 'boolean'],
            'stock_quantity' => [$isService ? 'prohibited' : 'sometimes', 'numeric', 'min:0'],
            'low_stock_threshold' => ['nullable', 'numeric', 'min:0'],

            // Service-only fields
            'duration_minutes' => [$isService ? 'nullable' : 'prohibited', 'integer', 'min:1', 'max:1440'],

            // Availability window (food menu hours) — HH:MM[:SS]
            'available_from' => ['nullable', 'date_format:H:i,H:i:s'],
            'available_until' => ['nullable', 'date_format:H:i,H:i:s'],

            'is_active' => ['sometimes', 'boolean'],
            'visible_in_marketplace' => ['sometimes', 'boolean'],

            // Variants (not for services)
            'variants' => [$isService ? 'prohibited' : 'sometimes', 'array', 'max:100'],
            'variants.*.name' => ['required_with:variants', 'string', 'max:100', 'distinct'],
            'variants.*.sku' => [
                'nullable', 'string', 'max:64', 'distinct',
                Rule::unique('product_variants', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
                Rule::unique('products', 'sku')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'variants.*.price' => ['required_with:variants', 'numeric', 'min:0'],
            'variants.*.cost' => ['nullable', 'numeric', 'min:0'],
            'variants.*.stock_quantity' => ['sometimes', 'numeric', 'min:0'],
            'variants.*.low_stock_threshold' => ['nullable', 'numeric', 'min:0'],
        ];
    }

    public function messages(): array
    {
        return [
            'sku.unique' => 'This SKU is already used by another item.',
            'barcode.unique' => 'This barcode is already used by another item.',
            'variants.*.sku.unique' => 'This SKU is already used by another item.',
            'variants.*.name.distinct' => 'Duplicate variant names in this request.',
            'variants.*.sku.distinct' => 'Duplicate variant SKUs in this request.',
            'stock_quantity.prohibited' => 'This item type does not track stock.',
            'variants.prohibited' => 'Services cannot have variants.',
            'duration_minutes.prohibited' => 'Only services have a duration.',
        ];
    }
}
