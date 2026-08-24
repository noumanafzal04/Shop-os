<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\BranchSoldOut;
use App\Models\Product;
use App\Models\ProductVariant;

/**
 * IS THIS OFF TONIGHT, HERE?
 *
 * Three paths sell: the counter (`CreateSaleAction`), an online order
 * (`OrderService`) and a dine-in tab (`AddTicketItemsAction`). Each asked the
 * question in its own words once, and that cost this shop a kitchen ticket for
 * a dish that was off — so the rule lives here, and
 * `scripts/one-rule-many-paths.py` can see all three consult it.
 *
 * ── Three dimensions, learned one at a time ─────────────────────────────
 *
 * A PRODUCT can be off: "no pizza tonight."
 * A SIZE can be off: a pizzeria runs out of large bases, not of pizza.
 * A BRANCH can be out: Gulberg's kitchen has none; DHA has a full tray.
 *
 * Each was built after the one before turned out to be a dimension short of
 * the thing it describes. The last one had one switch for a whole chain: a
 * chef in one kitchen took a dish off every menu in the company.
 *
 * ── The size is asked first ─────────────────────────────────────────────
 *
 * It is the more specific answer and the one a customer hears:
 *
 *     "No large, but we have medium"  is a sale.
 *     "No pizza" when only the large ran out  is a lost evening.
 *
 * ── What "trusted" means, and why it is not a parameter ─────────────────
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
     * Refuse a line for something this branch has run out of tonight.
     *
     * A null branch means "wherever this is being sold" and asks whether the
     * thing is off ANYWHERE — the headless paths (a job, a seeder, a shop with
     * one branch) land here, and for a single-branch shop the two readings are
     * the same sentence.
     */
    public static function assertSellable(
        Product $product,
        ?ProductVariant $variant = null,
        ?string $branchId = null,
    ): void {
        if ($variant !== null && self::isOff($product, $variant, $branchId)) {
            throw DomainException::unprocessable(
                "{$product->name} — {$variant->name} is sold out.",
                'ITEM_SOLD_OUT',
            );
        }

        if (self::isOff($product, null, $branchId)) {
            throw DomainException::unprocessable(
                "{$product->name} is sold out.",
                'ITEM_SOLD_OUT',
            );
        }
    }

    /** Is this exact thing off at this branch? */
    public static function isOff(Product $product, ?ProductVariant $variant = null, ?string $branchId = null): bool
    {
        return self::rows($product)
            ->contains(fn (BranchSoldOut $r) => $r->variant_id === $variant?->id
                && ($branchId === null || $r->branch_id === $branchId));
    }

    /**
     * The sizes this branch has run out of, as ids, for a projection.
     *
     * A till belongs to a branch, so the mirror it is handed carries THAT
     * branch's answer — the same shape as before, one dimension truer.
     */
    public static function offTonight(Product $product, ?string $branchId = null): array
    {
        return self::rows($product)
            ->filter(fn (BranchSoldOut $r) => $r->variant_id !== null
                && ($branchId === null || $r->branch_id === $branchId))
            ->pluck('variant_id')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Every 86 row for this product, loaded once.
     *
     * Read through the relation so a caller that eager-loaded it pays for one
     * query and not one per line — a fifty-line bill asking the database fifty
     * times is how a till stops feeling instant.
     */
    private static function rows(Product $product)
    {
        return $product->relationLoaded('soldOut')
            ? $product->soldOut
            : $product->soldOut()->get();
    }
}
