<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Support\ItemTypes;

/**
 * Replaces a deal's component list. Each component must be a real product in
 * the same shop, can't be the deal itself, and can't be another deal (no
 * nested bundles). Quantities must be positive.
 */
class SyncComboItemsAction
{
    /** @param array<array{component_product_id?: string, quantity?: mixed}> $items */
    public function execute(Product $combo, array $items): void
    {
        $tenantId = $combo->tenant_id;

        $clean = collect($items)
            ->map(fn ($i) => [
                'component_product_id' => (string) ($i['component_product_id'] ?? ''),
                'quantity' => (float) ($i['quantity'] ?? 1),
            ])
            ->filter(fn ($i) => $i['component_product_id'] !== '' && $i['quantity'] > 0)
            ->values();

        foreach ($clean as $i) {
            if ($i['component_product_id'] === $combo->id) {
                throw DomainException::unprocessable('A deal cannot contain itself.', 'COMBO_SELF_REFERENCE');
            }

            /** @var Product|null $component */
            $component = Product::query()->whereKey($i['component_product_id'])->first();
            if ($component === null) {
                throw DomainException::unprocessable('A deal component no longer exists.', 'COMBO_COMPONENT_MISSING');
            }
            if ($component->item_type === ItemTypes::DEAL) {
                throw DomainException::unprocessable('A deal cannot contain another deal.', 'COMBO_NESTED');
            }
        }

        $combo->comboItems()->delete();
        foreach ($clean as $sort => $i) {
            $combo->comboItems()->create([
                'tenant_id' => $tenantId,
                'component_product_id' => $i['component_product_id'],
                'quantity' => $i['quantity'],
                'sort_order' => $sort,
            ]);
        }
    }
}
