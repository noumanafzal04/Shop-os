<?php

namespace App\Support;

use App\Models\Product;
use App\Models\RecipeItem;

/**
 * What a dish costs to make.
 *
 * ── The number a restaurant lives by, computed from data it already had ──
 *
 * Every margin figure on this platform comes from `sale_items.unit_cost`, and
 * that was set from `product.cost` — a single number somebody typed into the
 * dish's record once. For a tin of paint that is exactly right: it is what the
 * shop paid.
 *
 * A cooked dish has no such number. Its cost is half a kilo of chicken, two
 * onions, oil and spices, and in Pakistan those move violently week to week.
 * A karahi priced against last winter's chicken is not priced at all.
 *
 * So the Margins report — the report a restaurant opens to decide what to
 * charge — was computed perfectly from a figure nobody maintains. **And every
 * ingredient of the real answer was already in the database:** the recipe
 * knows the quantities, the ingredients carry their own costs, and nothing
 * multiplied them.
 *
 * ── Unknown is not zero ─────────────────────────────────────────────────
 *
 * If ANY ingredient has no cost recorded, this returns null rather than a
 * partial sum. A partial food cost is not a smaller cost — it is a WRONG one,
 * and it is wrong in the dangerous direction: the dish looks more profitable
 * than it is, and a restaurant underprices against it. Better to say "I cannot
 * tell you" and name the ingredients that are missing.
 *
 * Same rule the disposals screen follows for a lot with no recorded cost. See
 * `docs/decisions/shopos-stock-disposals.md`.
 *
 * ── Recipes nest ────────────────────────────────────────────────────────
 *
 * A gravy base is prepped in the morning, a spice paste goes into the gravy,
 * and three dishes are built on top — which is how a real kitchen works. So an
 * ingredient that is itself a recipe is costed from ITS recipe, as deep as the
 * kitchen actually goes.
 *
 * The only guard is the set of dishes already seen on this branch, and it is
 * enough: the visited set only grows and there are finitely many products, so a
 * recipe that comes back round to itself terminates at the repeat. A DEPTH CAP
 * was written first and then removed — no test could tell it apart from this
 * one, and it bought a real cost: a legitimate four-deep nest would have come
 * back "uncostable" with nothing to say why.
 */
final class RecipeCost
{
    /**
     * Cost of one portion, or null when it cannot honestly be determined.
     *
     * Null means one of two things, and both are "don't quote a figure":
     * the dish has no recipe at all, or an ingredient somewhere under it has
     * no cost recorded.
     *
     * @param  array<string, true>  $seen  dish ids already on this branch
     */
    public static function forDish(Product $dish, array $seen = []): ?float
    {
        // A recipe that comes back round to itself is a mis-entry. Refuse in
        // the same way an unknown cost is refused, so a caller has one case to
        // handle instead of two.
        if (isset($seen[$dish->id])) {
            return null;
        }

        $seen[$dish->id] = true;

        $items = $dish->relationLoaded('recipeItems')
            ? $dish->recipeItems
            : $dish->recipeItems()->with('ingredient')->get();

        if ($items->isEmpty()) {
            return null;
        }

        $total = 0.0;

        foreach ($items as $item) {
            /** @var RecipeItem $item */
            $ingredient = $item->ingredient;

            if ($ingredient === null) {
                return null;
            }

            // A prepped sub-recipe costs what ITS ingredients cost, not what
            // somebody typed on it — the same argument one level down.
            $unit = self::forDish($ingredient, $seen)
                ?? ($ingredient->cost === null ? null : (float) $ingredient->cost);

            if ($unit === null) {
                return null;
            }

            $total += $unit * (float) $item->quantity;
        }

        return round($total, 2);
    }

    /**
     * Which ingredients are stopping the figure being computed.
     *
     * The half of this feature that makes it actionable: "I cannot cost this
     * dish" is a complaint, and "Onions and Cooking oil have no cost recorded"
     * is a job somebody can do in a minute.
     *
     * @return array<int, string> ingredient names, one level deep
     */
    public static function missingCosts(Product $dish): array
    {
        $items = $dish->relationLoaded('recipeItems')
            ? $dish->recipeItems
            : $dish->recipeItems()->with('ingredient')->get();

        $missing = [];

        foreach ($items as $item) {
            $ingredient = $item->ingredient;

            if ($ingredient === null) {
                continue;
            }

            // A sub-recipe that costs out fine is not missing anything, even
            // though its own `cost` column may be empty.
            if (self::forDish($ingredient) !== null) {
                continue;
            }

            if ($ingredient->cost === null) {
                $missing[] = $ingredient->name;
            }
        }

        return array_values(array_unique($missing));
    }
}
