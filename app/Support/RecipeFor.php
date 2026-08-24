<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\RecipeItem;
use Illuminate\Support\Collection;

/**
 * WHICH RECIPE, FOR WHICH SIZE.
 *
 * A recipe used to belong to a dish, so a pizza that comes in three sizes had
 * one recipe and every size drew the same flour. Measured before this existed:
 * one Small and one Large, both `2 dough`. A kitchen does not run out of pizza,
 * it runs out of large bases — the same argument that put sizes into 86 and
 * into deals.
 *
 * ── Override, not addition ──────────────────────────────────────────────
 *
 * A size's rows REPLACE the dish's rows; they are not added to them. Addition
 * reads fine in a sentence and then cannot express the ordinary case — a Large
 * that uses MORE of the same flour, not extra flour on top of the Small's.
 * Override says "the Large is made differently, here is how", which is what a
 * chef writing it down means.
 *
 * A size that names nothing falls back to the dish's own rows. That is what
 * every recipe in the database is today, so nothing that worked stops working
 * and no shop has to retype anything.
 *
 * ── Four readers, one answer ────────────────────────────────────────────
 *
 * The counter deducts it, the return restores it, the BOM snapshot records it
 * and `RecipeCost` prices it. Four copies of "which rows apply" is four chances
 * for one of them to forget the size — the shape that has already cost this
 * codebase a kitchen ticket for a dish that was off, and a deal that could not
 * be sold at all. So it is asked here, once.
 */
final class RecipeFor
{
    /**
     * The rows that actually apply to what is being sold.
     *
     * @return Collection<int, RecipeItem>
     */
    public static function rows(Product $dish, ?ProductVariant $variant = null): Collection
    {
        $all = $dish->relationLoaded('recipeItems')
            ? $dish->recipeItems
            : $dish->recipeItems()->with('ingredient')->get();

        if ($variant === null) {
            return self::base($all);
        }

        $mine = $all->filter(fn (RecipeItem $r) => $r->variant_id === $variant->id)->values();

        return $mine->isNotEmpty() ? $mine : self::base($all);
    }

    /** The dish's own rows — the recipe for it whatever size. */
    private static function base(Collection $all): Collection
    {
        return $all->filter(fn (RecipeItem $r) => $r->variant_id === null)->values();
    }

    /**
     * Does this dish spell out any size separately?
     *
     * Used to tell a merchant that every size will consume the same
     * ingredients — a thing worth SAYING and not worth refusing over, since a
     * shop may genuinely portion the same and every existing recipe is this.
     */
    public static function namesAnySize(Product $dish): bool
    {
        $all = $dish->relationLoaded('recipeItems')
            ? $dish->recipeItems
            : $dish->recipeItems()->get();

        return $all->contains(fn (RecipeItem $r) => $r->variant_id !== null);
    }
}
