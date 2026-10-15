<?php

namespace App\Support;

use App\Models\PurchaseOrderItem;
use Illuminate\Support\Collection;

/**
 * Who a shop last bought each of these from, and at what price.
 *
 * ── Why this had to be derived ──────────────────────────────────────────
 *
 * A product carries no supplier. That is not an oversight to fix with a
 * `supplier_id` column: a grocer buys sugar from whoever was cheapest that
 * week, and a chemist's distributor for one brand is not the distributor for
 * the next. A single "preferred supplier" field would be wrong within a month
 * and would then be wrong silently.
 *
 * But the shop's own purchase history knows perfectly well. Every delivery
 * already records the supplier, the product and what was paid. **The answer
 * was in the database and nothing read it** — the reorder list could tell you
 * what to buy and not who from, so the buyer read the screen and then typed the
 * whole order again by hand.
 *
 * ── Last, not cheapest, not most frequent ───────────────────────────────
 *
 * Deliberately the most recent. "Cheapest ever" quotes a price nobody will
 * honour today; "most often" keeps proposing a distributor the shop stopped
 * using in March. The last delivery is the one the buyer remembers and the
 * relationship they currently have.
 *
 * The price rides along for the same reason: the last thing actually paid is a
 * defensible starting figure on a DRAFT order. It is not a quote and the
 * buyer edits it — but a blank cost field means the whole order gets typed
 * anyway, which is what this exists to stop.
 */
class LastBoughtFrom
{
    /**
     * @param  array<int, string>  $productIds
     * @return Collection<string, object{supplier_id: string, supplier_name: string, unit_cost: float}> unit_cost per base unit (a piece), whatever pack it was bought in
     *                                                                                                  keyed by product id; products never bought are absent
     */
    public static function forProducts(array $productIds): Collection
    {
        if ($productIds === []) {
            return collect();
        }

        return PurchaseOrderItem::query()
            ->select([
                'purchase_order_items.product_id',
                'purchase_orders.supplier_id',
                'suppliers.name as supplier_name',
                'purchase_order_items.unit_cost',
                'purchase_order_items.unit_factor',
                'purchase_orders.order_date',
            ])
            ->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_items.purchase_order_id')
            ->join('suppliers', 'suppliers.id', '=', 'purchase_orders.supplier_id')
            ->whereIn('purchase_order_items.product_id', $productIds)
            // A cancelled order is not a relationship. It says what somebody
            // intended once and then thought better of.

            ->where('purchase_orders.status', '!=', 'cancelled')
            ->whereNull('purchase_orders.deleted_at')
            ->orderByDesc('purchase_orders.order_date')
            ->orderByDesc('purchase_orders.created_at')
            ->get()
            // First wins: the query is newest-first, so keyBy keeps the most
            // recent line per product and drops the history behind it.
            ->reduce(function (Collection $carry, $row): Collection {
                if (! $carry->has($row->product_id)) {
                    $carry->put($row->product_id, (object) [
                        'supplier_id' => $row->supplier_id,
                        'supplier_name' => $row->supplier_name,
                        // PER PIECE. A line bought as a "Box of 5" at 3,600
                        // carries the box's price; the reorder list orders
                        // pieces, and drafted 37 dupattas × 3,600 (tester
                        // pass 2, B32). 720 a piece is what it cost.
                        'unit_cost' => round((float) $row->unit_cost / max(1.0, (float) ($row->unit_factor ?? 1)), 2),
                    ]);
                }

                return $carry;
            }, collect());
    }
}
