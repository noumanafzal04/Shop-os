<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use Illuminate\Support\Facades\DB;

/**
 * Replaces a product's whole modifier-group set in one shot (matches the
 * editor UX). Old groups/options are removed and rebuilt from the payload.
 */
class SyncModifierGroupsAction
{
    public function execute(Product $product, array $groups): Product
    {
        DB::transaction(function () use ($product, $groups): void {
            // Cascade delete removes options with their groups.
            $product->modifierGroups()->delete();

            foreach (array_values($groups) as $gi => $g) {
                $group = $product->modifierGroups()->create([
                    'tenant_id' => $product->tenant_id,
                    'name' => $g['name'],
                    'type' => $g['type'] ?? 'modifier',
                    'min_select' => (int) $g['min_select'],
                    'max_select' => (int) $g['max_select'],
                    'sort_order' => $gi,
                ]);

                foreach (array_values($g['options']) as $oi => $o) {
                    $group->options()->create([
                        'tenant_id' => $product->tenant_id,
                        'name' => $o['name'],
                        'price_delta' => round((float) ($o['price_delta'] ?? 0), 2),
                        'is_default' => (bool) ($o['is_default'] ?? false),
                        'sort_order' => $oi,
                    ]);
                }
            }
        });

        return $product->load('modifierGroups.options');
    }
}
