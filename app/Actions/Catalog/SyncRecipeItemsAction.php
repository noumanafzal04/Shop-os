<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Support\ItemTypes;

/**
 * Replaces a dish's recipe (its raw ingredients + quantities). Each ingredient
 * must be a real product in the same shop, can't be the dish itself, can't be
 * a deal, and can't itself have a recipe (no nested BOM). Quantities positive.
 */
class SyncRecipeItemsAction
{
    /** @param array<array{ingredient_product_id?: string, quantity?: mixed}> $items */
    public function execute(Product $dish, array $items): void
    {
        $tenantId = $dish->tenant_id;

        $clean = collect($items)
            ->map(fn ($i) => [
                'ingredient_product_id' => (string) ($i['ingredient_product_id'] ?? ''),
                'quantity' => (float) ($i['quantity'] ?? 1),
            ])
            ->filter(fn ($i) => $i['ingredient_product_id'] !== '' && $i['quantity'] > 0)
            ->values();

        foreach ($clean as $i) {
            if ($i['ingredient_product_id'] === $dish->id) {
                throw DomainException::unprocessable('A dish cannot be its own ingredient.', 'RECIPE_SELF_REFERENCE');
            }

            /** @var Product|null $ingredient */
            $ingredient = Product::query()->whereKey($i['ingredient_product_id'])->first();
            if ($ingredient === null) {
                throw DomainException::unprocessable('An ingredient no longer exists.', 'RECIPE_INGREDIENT_MISSING');
            }
            if ($ingredient->item_type === ItemTypes::DEAL) {
                throw DomainException::unprocessable('A deal cannot be an ingredient.', 'RECIPE_INGREDIENT_DEAL');
            }
            if ($ingredient->hasRecipe()) {
                throw DomainException::unprocessable('An ingredient cannot itself be a recipe dish.', 'RECIPE_NESTED');
            }
        }

        $dish->recipeItems()->delete();
        foreach ($clean as $sort => $i) {
            $dish->recipeItems()->create([
                'tenant_id' => $tenantId,
                'ingredient_product_id' => $i['ingredient_product_id'],
                'quantity' => $i['quantity'],
                'sort_order' => $sort,
            ]);
        }
    }
}
