<?php

namespace App\Actions\Catalog;

use App\Models\Product;
use Illuminate\Support\Facades\DB;

class UpdateProductAction
{
    public function __construct(
        private readonly SyncProductBarcodesAction $syncBarcodes,
        private readonly SyncProductUnitsAction $syncUnits,
        private readonly SyncComboItemsAction $syncCombo,
        private readonly SyncRecipeItemsAction $syncRecipe,
    ) {}

    /**
     * @return array{product: Product, warnings: string[]}
     */
    public function execute(Product $product, array $data): array
    {
        // Relations aren't columns — pull them out before fill.
        $collectionIds = $data['collection_ids'] ?? null;
        unset($data['collection_ids']);
        $barcodes = array_key_exists('barcodes', $data) ? ($data['barcodes'] ?? []) : null;
        unset($data['barcodes']);
        $units = array_key_exists('units', $data) ? ($data['units'] ?? []) : null;
        unset($data['units']);
        $comboItems = array_key_exists('combo_items', $data) ? ($data['combo_items'] ?? []) : null;
        unset($data['combo_items']);
        $recipeItems = array_key_exists('recipe_items', $data) ? ($data['recipe_items'] ?? []) : null;
        unset($data['recipe_items']);

        DB::transaction(function () use ($product, $data, $collectionIds, $barcodes, $units, $comboItems, $recipeItems): void {
            $product->fill($data)->save();

            if ($collectionIds !== null) {
                $product->collections()->sync($collectionIds);
            }

            // Only touch barcodes when the caller sent the key (a bare field
            // edit shouldn't wipe them).
            if ($barcodes !== null) {
                $this->syncBarcodes->execute($product, $barcodes);
            }

            if ($units !== null) {
                $this->syncUnits->execute($product, $units);
            }

            if ($comboItems !== null) {
                $this->syncCombo->execute($product, $comboItems);
            }

            if ($recipeItems !== null) {
                $this->syncRecipe->execute($product, $recipeItems);
            }
        });

        $product->load('category', 'variants', 'images', 'collections', 'units', 'comboItems.component:id,name', 'recipeItems.ingredient:id,name');

        $warnings = [];

        if ($product->cost !== null && (float) $product->price < (float) $product->cost) {
            $warnings[] = 'Selling price is below cost — this item sells at a loss.';
        }

        return ['product' => $product, 'warnings' => $warnings];
    }
}
