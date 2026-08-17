<?php

namespace App\Support;

/**
 * What the stock on the shelf actually cost, once a new delivery joins it.
 *
 * ── The number that was typed once and never moved ──────────────────────
 *
 * Every margin, profit and COGS figure on this platform comes from
 * `products.cost`. Nothing ever wrote to it except a human on the product form.
 *
 * A kiryana bought sugar at Rs 140/kg in March. Every delivery since has been
 * 148, then 155, then 162 — and each of those was recorded, on the purchase
 * order line, at its true price. The product's own cost stayed 140, so every
 * sale filed `unit_cost` 140, and the Margins report told a shopkeeper he was
 * making Rs 22/kg while he was making eight.
 *
 * In a country where atta, ghee and sugar move monthly, a cost typed once is
 * not a stale figure — it is a fiction that gets further from the truth every
 * week, on the report a shop uses to decide its prices.
 *
 * **And the real answer was already in the database**, written by the shop's own
 * receiving, at every single delivery. Nothing read it.
 *
 * ── Why a weighted average and not the last price ───────────────────────
 *
 * Because the shelf holds both. Forty kilos bought at 140 and sixty at 160 is
 * not stock worth 160 — it is stock worth 152, and selling it at a margin
 * calculated on 160 gives away the eight rupees of it that were already earned.
 *
 * A last-price rule is simpler to explain and wrong in both directions: it
 * overstates cost while old cheap stock is still selling, then understates it
 * the moment one odd delivery comes in at a discount. A weighted average is
 * self-correcting — as the old stock sells through, the figure converges on
 * what the shop is really paying now, without anybody keying anything.
 *
 * ── What it refuses to do ───────────────────────────────────────────────
 *
 * It never blanks a cost that exists. A purchase line with no price recorded is
 * missing information, not evidence that the goods were free, and letting one
 * wipe a good figure would lose the very number this exists to keep true.
 */
final class MovingCost
{
    /**
     * The blended cost per base unit after a delivery lands.
     *
     * @param  float|null  $oldCost  cost per unit before this delivery
     * @param  float  $oldQty  units on hand before it
     * @param  float|null  $newCost  cost per unit of what arrived
     * @param  float  $newQty  units that arrived
     */
    public static function blend(?float $oldCost, float $oldQty, ?float $newCost, float $newQty): ?float
    {
        // Nothing priced arrived. Whatever was known stays known — a delivery
        // recorded without a price is missing information, not free goods.
        if ($newCost === null || $newQty <= 0) {
            return $oldCost;
        }

        // Nothing to blend with: no prior figure, or the shelf was empty (or
        // negative, which happens on an oversold line). The delivery IS the
        // cost.
        if ($oldCost === null || $oldQty <= 0) {
            return round($newCost, 2);
        }

        return round(
            (($oldCost * $oldQty) + ($newCost * $newQty)) / ($oldQty + $newQty),
            2,
        );
    }
}
