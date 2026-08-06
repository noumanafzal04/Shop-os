<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\ItemTypes;
use App\Support\TenantContext;

/**
 * Replaces a dish's recipe (its raw ingredients + quantities). Each ingredient
 * must be a real product in the same shop, can't be the dish itself, can't be
 * a deal, and can't itself have a recipe (no nested BOM). Quantities positive.
 *
 * A recipe does exactly one thing: selling the dish draws each ingredient down
 * (CreateSaleAction). So two things have to be true for it to mean anything,
 * and both were false for a brand-new restaurant — a merchant could write out
 * a full recipe, save it without complaint, and have it deplete nothing:
 *
 *  - the shop must run the INVENTORY module. Without it there is no stock to
 *    draw down, so a recipe is refused rather than stored as decoration.
 *  - the ingredient must be STOCK-TRACKED. Food items default to untracked (a
 *    plate of biryani holds no stock of its own), which is right for the dish
 *    and wrong for the flour. Naming something as an ingredient IS the
 *    merchant saying it gets consumed and counted, so tracking is switched on
 *    here — and reported back, because it changes how that item behaves when
 *    sold on its own.
 */
class SyncRecipeItemsAction
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @param  array<array{ingredient_product_id?: string, quantity?: mixed}>  $items
     * @return string[] warnings to show the merchant
     */
    public function execute(Product $dish, array $items): array
    {
        $tenantId = $dish->tenant_id;

        $clean = collect($items)
            ->map(fn ($i) => [
                'ingredient_product_id' => (string) ($i['ingredient_product_id'] ?? ''),
                'quantity' => (float) ($i['quantity'] ?? 1),
            ])
            ->filter(fn ($i) => $i['ingredient_product_id'] !== '' && $i['quantity'] > 0)
            ->values();

        // Clearing a recipe stays open to everyone — a shop that loses the
        // stock module must still be able to tidy up after itself.
        if ($clean->isNotEmpty() && ! $this->tracksStock($dish)) {
            throw DomainException::unprocessable(
                'A recipe deducts ingredients from stock, so this shop needs the Inventory module before it can keep one.',
                'RECIPE_NEEDS_INVENTORY',
            );
        }

        /** @var list<Product> $ingredients */
        $ingredients = [];

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

            $ingredients[] = $ingredient;
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

        return $this->trackIngredients($ingredients);
    }

    /**
     * An ingredient nobody counts is depleted by nothing. Switch tracking on
     * for the ones that can hold stock, and name the ones that can't.
     *
     * @param  list<Product>  $ingredients
     * @return string[]
     */
    private function trackIngredients(array $ingredients): array
    {
        $warnings = [];
        $switchedOn = [];
        $untrackable = [];

        foreach ($ingredients as $ingredient) {
            if (! ItemTypes::canTrackInventory($ingredient->item_type)) {
                $untrackable[] = $ingredient->name;

                continue;
            }
            if ($ingredient->track_inventory) {
                continue;
            }

            $ingredient->forceFill(['track_inventory' => true])->save();
            $switchedOn[] = $ingredient->name;
        }

        if ($switchedOn !== []) {
            $warnings[] = 'Now tracked as stock so the recipe can deduct them: '
                .implode(', ', $switchedOn)
                .'. Set their opening quantities on the Inventory screen.';
        }

        // A service line can never be deducted — say so rather than let the
        // merchant believe the labour on the ticket is being consumed.
        if ($untrackable !== []) {
            $warnings[] = 'Not deducted from stock, nothing to count: '.implode(', ', $untrackable).'.';
        }

        return $warnings;
    }

    /** Does the dish's shop run the stock module? */
    private function tracksStock(Product $dish): bool
    {
        $tenant = $this->context->get();

        // Outside a tenant request (console, jobs) fall back to the dish's own
        // shop rather than assuming either answer.
        if ($tenant === null || $tenant->id !== $dish->tenant_id) {
            $tenant = Tenant::query()->find($dish->tenant_id);
        }

        return $tenant !== null && $tenant->featureEnabled('inventory');
    }
}
