<?php

namespace App\Support;

use Illuminate\Contracts\Database\Query\Builder as BuilderContract;
use Illuminate\Database\Eloquent\Builder;

/**
 * WHAT IS RUNNING OUT — one answer, wherever the question is asked.
 *
 * Three places asked it and two answers came back. The catalogue's
 * `?low_stock=1` filter summed a product's SIZES; the **Needs reordering**
 * list — the screen a buyer actually orders from — read `products.stock_quantity`
 * instead. For a product sold in sizes that column is what
 * `Product::effectiveStock()` calls an orphaned leftover that must not be read
 * as truth: the stock is on the rows below and the parent keeps whatever it was
 * created with, which is nought.
 *
 * `0 <= threshold` is true for every threshold a shop would ever set, so a
 * clothes shop holding two hundred shirts was told to reorder every one of
 * them, every day, for ever. A list that says everything says nothing, and a
 * trader stops opening it inside a week. It hit precisely the trades built on
 * sizes: retail (size/colour), pharmacy (strength), a diner (portion).
 *
 * ── Why a branch is a different sum, not a different rule ───────────────
 *
 * `branch_stock` already holds one row per SIZE per branch, so summing it needs
 * no variant arm — the sizes are the rows. A product with no row on this
 * branch's shelf holds none of it, which is the most urgent case there is, and
 * a `coalesce(…, 0)` keeps it in rather than letting a join drop it.
 *
 * Shop-wide there is no such table to lean on, so the sum has to choose: a
 * product WITH sizes is the sum of its sizes, a product without is its own
 * column. That choice is the bug this class exists to stop anybody making
 * twice.
 */
final class LowStock
{
    /**
     * Narrow `$query` to the products at or below their reorder level.
     *
     * @param  string|null  $branchId  the branch being operated, or null for the whole shop
     */
    public static function apply(Builder $query, ?string $branchId = null): Builder
    {
        return self::watched($query)
            ->when(
                $branchId !== null,
                fn (Builder $q): Builder => $q->whereRaw(
                    '(select coalesce(sum(bs.quantity), 0) from branch_stock bs'
                    .' where bs.product_id = products.id and bs.branch_id = ?) <= products.low_stock_threshold',
                    [$branchId],
                ),
                fn (Builder $q): Builder => $q->where(self::shopWide(...)),
            );
    }

    /**
     * On hand across the whole shop: the sizes if there are any, else the
     * product's own column. Split in two rather than written as one
     * `coalesce`, because "has no variants" and "has variants summing to zero"
     * are different shops with different answers.
     */
    /**
     * The items this shop has asked to be told about at all.
     *
     * No threshold set is not "zero" — it is a shop that has never said what
     * low means for this item, and inventing a level would fill the list with
     * things nobody asked to be told about.
     *
     * It is also the DENOMINATOR of the reorder list. An empty list has two
     * unrelated causes — nothing is below its level (good news), or nobody has
     * set a level, in which case the screen can never show a row — and the
     * count tells them apart. It has to mean the same "watched" the list
     * means, or the screen explains its own emptiness with a number from a
     * different rule. It was written out again in the controller.
     *
     * @param  Builder<Product>  $query
     * @return Builder<Product>
     */
    public static function watched(Builder $query): Builder
    {
        return $query
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold');
    }

    private static function shopWide(BuilderContract $where): void
    {
        $where
            ->where(fn (BuilderContract $x) => $x
                ->whereDoesntHave('variants')
                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold'))
            ->orWhere(fn (BuilderContract $x) => $x
                ->whereHas('variants')
                ->whereRaw(
                    '(select coalesce(sum(pv.stock_quantity), 0) from product_variants pv'
                    .' where pv.product_id = products.id and pv.deleted_at is null) <= low_stock_threshold',
                ));
    }
}
