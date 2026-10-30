<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductVariant;
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
 * ── A size costs what a size uses ───────────────────────────────────────
 *
 * A Large pizza is not a Small at a higher price — it is more dough. When a
 * recipe row names a size, this costs THAT size, because the margin report is
 * exactly where an averaged food cost does its damage: the shop prices every
 * size against a number that is right for none of them.
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
    public static function forDish(Product $dish, array $seen = [], ?ProductVariant $variant = null): ?float
    {
        // A recipe that comes back round to itself is a mis-entry. Refuse in
        // the same way an unknown cost is refused, so a caller has one case to
        // handle instead of two.
        if (isset($seen[$dish->id])) {
            return null;
        }

        $seen[$dish->id] = true;

        // WHICH SIZE is being costed. A Large is made differently from a Small,
        // so it costs differently — and the margin report a restaurant prices
        // against is exactly where that must not be averaged away.
        $items = RecipeFor::rows($dish, $variant);

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
    /**
     * WHAT ONE DEAL COSTS: the sum of what is in it (#RS1, #RS13) — a dish by
     * its recipe, anything else by what was paid for it, a size by its own
     * cost first. Null when any part has none: one part without a cost makes
     * the whole figure a guess, and a guess reads as a smaller cost.
     *
     * The one rule for the sale line (`CreateSaleAction::lineCost`) and the
     * deal's own card, which said nothing — an owner learned what a deal cost
     * only by selling one.
     */
    public static function forDeal(Product $deal): ?float
    {
        $parts = $deal->comboItems()->with('component')->get();
        if ($parts->isEmpty()) {
            return null;
        }

        $sum = 0.0;
        foreach ($parts as $ci) {
            $each = self::ofPart($ci->component, $ci->variant_id);
            if ($each === null) {
                return null;
            }
            $sum += $each * (float) $ci->quantity;
        }

        return round($sum, 2);
    }

    /**
     * Which of a deal's parts are stopping its cost being computed.
     *
     * @return array<int, string> part names
     */
    public static function dealMissing(Product $deal): array
    {
        return $deal->comboItems()->with('component')->get()
            ->filter(fn ($ci) => self::ofPart($ci->component, $ci->variant_id) === null)
            ->map(fn ($ci) => $ci->component?->name ?? 'A removed item')
            ->unique()->values()->all();
    }

    /** One part of a deal: a dish by its recipe, else what was paid. Never a deal inside a deal. */
    private static function ofPart(?Product $part, ?string $variantId): ?float
    {
        if ($part === null || $part->isCombo()) {
            return null;
        }
        $size = $variantId === null ? null : ProductVariant::query()->find($variantId);

        return self::forDish($part, [], $size) ?? UnitCost::ofPack($part, $size, 1.0);
    }

    public static function missingCosts(Product $dish, ?ProductVariant $variant = null): array
    {
        $items = RecipeFor::rows($dish, $variant);

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
