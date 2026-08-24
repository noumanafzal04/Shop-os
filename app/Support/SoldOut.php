<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductVariant;

/**
 * IS THIS OFF TONIGHT?
 *
 * Three paths sell: the counter (`CreateSaleAction`), an online order
 * (`OrderService`) and a dine-in tab (`AddTicketItemsAction`). Each asked the
 * question in its own words, and that has already cost this shop once —
 * `ITEM_SOLD_OUT` lived on the counter alone for a while, so the app took the
 * order anyway and the tab printed a kitchen ticket for a dish that was off.
 *
 * Now a SIZE can be off while the product is not, which is what a kitchen
 * actually runs out of. Three copies of a two-part rule is three chances for one
 * of them to check the product and forget the size — so the rule is here, once,
 * and `scripts/one-rule-many-paths.py` can see that all three consult it.
 *
 * ── What "trusted" means, and why it is not a parameter here ────────────
 *
 * A dine-in settle and an online order's capture are food the customer already
 * committed to, usually already eaten; refusing to take their money because the
 * kitchen has since run out is not a protection, it is a shop that cannot close
 * a bill. Those paths simply do not call this. Deciding it here would hide the
 * choice inside a helper, and it is a choice each path has to make out loud.
 */
class SoldOut
{
    /**
     * Refuse a line for something that is off tonight.
     *
     * The SIZE first, because it is the more specific answer and the one a
     * customer hears: "no large, but we have medium" is a sale, and
     * "no pizza" when only the large ran out is a lost evening.
     */
    public static function assertSellable(Product $product, ?ProductVariant $variant = null): void
    {
        if ($variant !== null && $variant->sold_out_at !== null) {
            throw DomainException::unprocessable(
                "{$product->name} — {$variant->name} is sold out.",
                'ITEM_SOLD_OUT',
            );
        }

        if ($product->sold_out_at !== null) {
            throw DomainException::unprocessable(
                "{$product->name} is sold out.",
                'ITEM_SOLD_OUT',
            );
        }
    }

    /** Everything a shop has taken off tonight, as ids, for a projection. */
    public static function offTonight(Product $product): array
    {
        return $product->variants
            ->filter(fn (ProductVariant $v) => $v->sold_out_at !== null)
            ->pluck('id')
            ->all();
    }
}
