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
     * @param  array<array{ingredient_product_id?: string, quantity?: mixed, variant_id?: string|null}>  $items
     * @return string[] warnings to show the merchant
     */
    public function execute(Product $dish, array $items): array
    {
        $tenantId = $dish->tenant_id;

        $clean = collect($items)
            ->map(fn ($i) => [
                'ingredient_product_id' => (string) ($i['ingredient_product_id'] ?? ''),
                'quantity' => (float) ($i['quantity'] ?? 1),
                // Which SIZE this row is the recipe for; null is "the dish,
                // whatever size", which is what every row was before sizes
                // could be named.
                'variant_id' => ($i['variant_id'] ?? null) ?: null,
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

        $sizes = $dish->variants()->pluck('id')->all();

        foreach ($clean as $i) {
            // A size named here must be a size of THIS dish. Silently keeping a
            // row nailed to somebody else's variant would make a recipe that
            // never applies to anything — stored, visible, and consumed by
            // nothing.
            if ($i['variant_id'] !== null && ! in_array($i['variant_id'], $sizes, true)) {
                throw DomainException::unprocessable(
                    'A recipe line names a size this dish does not have.',
                    'RECIPE_VARIANT_UNKNOWN',
                );
            }

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

        // The same ingredient may appear once per size, and once for the dish
        // — but not twice for the same size, which would silently double a
        // deduction. `distinct` on the request cannot express a PAIR.
        $pairs = [];
        foreach ($clean as $i) {
            $key = $i['variant_id'].'|'.$i['ingredient_product_id'];
            if (isset($pairs[$key])) {
                throw DomainException::unprocessable(
                    'The same ingredient is listed twice for one size.',
                    'RECIPE_DUPLICATE',
                );
            }
            $pairs[$key] = true;
        }

        $dish->recipeItems()->delete();
        foreach ($clean as $sort => $i) {
            $dish->recipeItems()->create([
                'tenant_id' => $tenantId,
                'ingredient_product_id' => $i['ingredient_product_id'],
                'variant_id' => $i['variant_id'],
                'quantity' => $i['quantity'],
                'sort_order' => $sort,
            ]);
        }

        return array_merge(
            $this->trackIngredients($ingredients),
            $this->sizesShareOneRecipe($dish, $clean->pluck('variant_id')->filter()->isNotEmpty()),
        );
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

    /**
     * A dish with sizes whose recipe names none of them.
     *
     * SAID, not refused. Every recipe in the database is this shape, so
     * refusing would break shops that have done nothing wrong, and a kitchen
     * may genuinely portion the same across sizes. But it is worth knowing:
     * before this could be said, a pizzeria's Small and Large drew identical
     * flour and nothing anywhere hinted at it.
     *
     * @return string[]
     */
    private function sizesShareOneRecipe(Product $dish, bool $namesASize): array
    {
        if ($namesASize || $dish->variants()->count() === 0) {
            return [];
        }

        return ['Every size of this dish will consume the same ingredients. '
            .'Add a line for a size if a larger one uses more.'];
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
