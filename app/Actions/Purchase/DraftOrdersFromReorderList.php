<?php

namespace App\Actions\Purchase;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Support\BranchContext;
use App\Support\LastBoughtFrom;
use Illuminate\Support\Facades\DB;

/**
 * Turning "these are running out" into orders somebody can send.
 *
 * ── The link that was missing ───────────────────────────────────────────
 *
 * The reorder list has always known what is running out. Purchase Orders has
 * always known how to buy. Nothing joined them, so the buyer read one screen
 * and re-typed every line into the other — which is the work this list exists
 * to save, done twice.
 *
 * ── One order per SUPPLIER, and that is the whole design ────────────────
 *
 * The obvious version — "make a purchase order from this list" — is wrong, and
 * wrong in a way that only shows up in a real shop. A grocer's reorder list on
 * a Monday holds twenty lines from five different distributors. One order
 * containing all twenty is not an order anybody can send.
 *
 * So the selection is grouped by who each item was last bought from, and one
 * DRAFT is created per supplier. Five drafts, each sendable.
 *
 * ── Draft, never placed ─────────────────────────────────────────────────
 *
 * Every quantity and price here is a suggestion built from history, and the
 * one thing this must never do is commit a shop to buying something. A draft
 * is the buyer's starting point: they adjust it, and placing it stays the
 * decision it always was.
 *
 * ── The quantity is the shortfall, and nothing cleverer ─────────────────
 *
 * Enough to get back above the shop's own low-stock threshold. It is tempting
 * to multiply — order double, order a month's cover — but every one of those
 * numbers would be invented here rather than chosen by the shop, and an
 * invented number on a real order is a guess dressed as advice. The buyer
 * knows their own turnover and the draft is editable.
 *
 * ── Items nobody has ever bought are refused, not guessed ───────────────
 *
 * A product with no purchase history has no supplier to propose. Putting it on
 * somebody's order because they happened to be first in the list would send a
 * real order to a stranger. It comes back named, so the screen can say which
 * ones need a supplier chosen by hand.
 */
class DraftOrdersFromReorderList
{
    public function __construct(
        private readonly CreatePurchaseOrderAction $create,
        private readonly BranchContext $branch,
    ) {}

    /**
     * @param  array<int, string>  $productIds
     * @return array{orders: array<int, PurchaseOrder>, unknown: array<int, string>}
     *                                                                               `unknown` names products with no purchase history
     */
    public function execute(array $productIds): array
    {
        $products = Product::query()
            ->whereIn('id', $productIds)
            ->where('track_inventory', true)
            ->get()
            ->keyBy('id');

        if ($products->isEmpty()) {
            throw DomainException::unprocessable(
                'None of those items are stocked, so there is nothing to order.',
                'NOTHING_TO_ORDER',
            );
        }

        $lastBought = LastBoughtFrom::forProducts($products->keys()->all());

        $bySupplier = [];
        $unknown = [];

        foreach ($products as $id => $product) {
            $last = $lastBought->get($id);

            if ($last === null) {
                $unknown[] = $product->name;

                continue;
            }

            $bySupplier[$last->supplier_id][] = [
                'product_id' => $id,
                'quantity' => $this->shortfall($product),
                'unit_cost' => $last->unit_cost,
            ];
        }

        if ($bySupplier === []) {
            throw DomainException::unprocessable(
                'None of those items have been bought before, so there is no supplier to order from. '
                .'Raise the first order by hand and this list will know next time.',
                'NO_SUPPLIER_HISTORY',
            );
        }

        // One transaction for the lot: a buyer who asked for five orders and
        // got three has to work out which two are missing before they can
        // safely press it again.
        $orders = DB::transaction(fn () => collect($bySupplier)
            ->map(fn (array $items, string $supplierId) => $this->create->execute([
                'supplier_id' => $supplierId,
                'order_date' => now()->toDateString(),
                'status' => 'draft',
                'notes' => 'Raised from the reorder list.',
                'items' => $items,
            ]))
            ->values()
            ->all());

        return ['orders' => $orders, 'unknown' => $unknown];
    }

    /**
     * How many it takes to get back above the threshold, at this branch.
     *
     * Never below 1: a product sitting exactly ON its threshold has a shortfall
     * of zero, and an order line for nothing is not an order line. It is on the
     * list because the shop said this is the level at which it buys more.
     */
    private function shortfall(Product $product): float
    {
        $onHand = $this->branch->scopeId() === null
            ? (float) $product->stock_quantity
            : (float) DB::table('branch_stock')
                ->where('product_id', $product->id)
                ->where('branch_id', $this->branch->scopeId())
                ->sum('quantity');

        return max(1.0, ceil((float) $product->low_stock_threshold - $onHand));
    }
}
