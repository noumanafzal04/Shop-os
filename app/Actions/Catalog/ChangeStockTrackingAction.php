<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\RecipeItem;
use App\Support\ItemTypes;

/**
 * WHETHER A SHOP COUNTS AN ITEM — decided again, after the item was made.
 *
 * ── What was there ───────────────────────────────────────────────────
 *
 * The item form has a switch, "Track stock for this item", and on an item that
 * already existed it did nothing: the form never sent it, and the request
 * prohibited it. It flipped, the form saved, and it was back where it started
 * the next time the item was opened.
 *
 * That is survivable while every item is born right. It was not: a dish made
 * before the form had been told what a dish is was born COUNTED, at a stock of
 * zero — "none left" at every table, on the first dish a new restaurant ever
 * carded — and the only switch that could say otherwise was this one.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * Counting can be started on anything a shelf can hold, and stopped on
 * anything nothing else is counting ON:
 *
 *   a unit sold by its serial number is counted one by one, always
 *   a dated lot on the shelf cannot expire if nobody is counting it
 *   a dish cannot use up an ingredient nobody counts
 *
 * Each of those is refused in words that say what to do first.
 *
 * ── And the number is not touched ────────────────────────────────────
 *
 * Stopping does not zero the shelf and starting does not invent one. A stock
 * figure changes through a movement with a reason and a name on it (a count,
 * an adjustment, a delivery) and never as a side effect of a switch. So an
 * item that stops being counted keeps its last figure on record, out of the
 * stock value; and one that starts is counted from whatever the books hold —
 * which for a dish is nothing, and the shop is TOLD it is now out of stock
 * rather than left to find out at a table.
 */
class ChangeStockTrackingAction
{
    /**
     * @return string[] what the shop should be told about what it just did
     */
    public function execute(Product $product, bool $counted): array
    {
        if ($counted === (bool) $product->track_inventory) {
            return [];
        }

        return $counted ? $this->start($product) : $this->stop($product);
    }

    /** @return string[] */
    private function start(Product $product): array
    {
        if (! ItemTypes::canTrackInventory($product->item_type)) {
            throw new DomainException(
                "{$product->name} is not something a shelf holds, so there is nothing to count.",
                422,
                'STOCK_NOT_COUNTED_FOR_TYPE',
            );
        }

        $product->forceFill(['track_inventory' => true])->save();

        $onHand = $product->effectiveStock();

        return [$onHand > 0
            ? "{$product->name} is counted again, from the ".self::quantity($onHand).' on the books.'
            : "{$product->name} is counted from now and there is none on the books — it is out of stock until some is added on the Inventory screen."];
    }

    /** @return string[] */
    private function stop(Product $product): array
    {
        if ($product->tracksSerial()) {
            throw new DomainException(
                "{$product->name} is sold by its serial number, so every unit of it is counted.",
                422,
                'STOCK_COUNT_REQUIRED',
            );
        }

        $lots = $product->batches()->where('quantity', '>', 0)->count();
        if ($lots > 0) {
            throw new DomainException(
                "{$product->name} has {$lots} dated ".($lots === 1 ? 'lot' : 'lots').' on the shelf. '
                .'Sell or write them off first — a lot nobody counts cannot run out or expire.',
                422,
                'STOCK_COUNT_REQUIRED',
            );
        }

        $dishes = RecipeItem::query()
            ->where('ingredient_product_id', $product->id)
            ->distinct()
            ->count('dish_product_id');
        if ($dishes > 0) {
            throw new DomainException(
                "{$product->name} is an ingredient of {$dishes} ".($dishes === 1 ? 'dish' : 'dishes').'. '
                .'A dish cannot use up something nobody counts — take it out of '
                .($dishes === 1 ? 'that recipe' : 'those recipes').' first.',
                422,
                'STOCK_COUNT_REQUIRED',
            );
        }

        $onHand = $product->effectiveStock();
        $product->forceFill(['track_inventory' => false])->save();

        return $onHand != 0.0
            ? ["{$product->name} is no longer counted. The ".self::quantity($onHand).' on the books stay on record, and are left out of the stock value.']
            : [];
    }

    /** 12 · 2.5 · -3 — a quantity as a person writes it. */
    private static function quantity(float $n): string
    {
        return rtrim(rtrim(number_format($n, 3, '.', ','), '0'), '.');
    }
}
