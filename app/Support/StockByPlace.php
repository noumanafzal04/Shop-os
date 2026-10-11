<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\StockTransfer;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * WHERE THE STOCK IS — every place at once.
 *
 * The shelf figure everybody reads is one number: the place being looked at,
 * or the whole business added up. Neither answers the question a shop with a
 * godown asks all day — "the shelf is empty; is there more in the back?" — and
 * a chain asks the same thing about its other branches. The one screen that
 * could answer it did so one product at a time, at the till.
 *
 * Everything here is read for a KNOWN LIST of products — a page of them, or a
 * reorder list — in a fixed number of queries. Nothing asks the database once
 * per product or once per place.
 */
final class StockByPlace
{
    /**
     * The places stock can be at, shops first, then warehouses.
     *
     * @return Collection<int, Branch>
     */
    public static function places(string $tenantId): Collection
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderByRaw("case when kind = 'shop' then 0 else 1 end")
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name', 'kind', 'is_default']);
    }

    /**
     * On hand, per product, per size, per place.
     *
     * @param  list<string>  $productIds
     * @return array<string, array<string, array<string, float>>> productId → (variantId or '') → branchId → quantity
     */
    public static function onHand(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        $held = [];
        $rows = DB::table('branch_stock')
            ->whereIn('product_id', $productIds)
            ->where('quantity', '<>', 0)
            ->get(['product_id', 'variant_id', 'branch_id', 'quantity']);

        foreach ($rows as $row) {
            $held[$row->product_id][$row->variant_id ?? ''][$row->branch_id] = (float) $row->quantity;
        }

        return $held;
    }

    /**
     * Sent and not yet counted in: on a van, on nobody's shelf.
     *
     * Shown beside the shelves because otherwise it is simply missing — forty
     * cartons left the godown this morning, the shop has not received them,
     * and the business's total is forty lower with no line to say why.
     *
     * @param  list<string>  $productIds
     * @return array<string, array<string, float>> productId → (variantId or '') → quantity
     */
    public static function onTheRoad(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        $moving = [];
        $rows = DB::table('stock_transfer_items as i')
            ->join('stock_transfers as t', 't.id', '=', 'i.stock_transfer_id')
            ->where('t.status', StockTransfer::IN_TRANSIT)
            ->whereNull('t.deleted_at')
            ->whereIn('i.product_id', $productIds)
            ->groupBy('i.product_id', 'i.variant_id')
            ->get(['i.product_id', 'i.variant_id', DB::raw('sum(i.quantity) as quantity')]);

        foreach ($rows as $row) {
            $moving[$row->product_id][$row->variant_id ?? ''] = (float) $row->quantity;
        }

        return $moving;
    }

    /**
     * Who else holds each of these products — every OTHER open place with some
     * of it, the fullest first.
     *
     * This is what turns "reorder" into "bring it from the back": a shelf that
     * has run down while the godown holds forty is not a purchase order.
     *
     * @param  list<string>  $productIds
     * @return array<string, list<array{branch_id: string, name: string, kind: string, quantity: float}>>
     */
    public static function elsewhere(array $productIds, string $notAtBranchId): array
    {
        if ($productIds === []) {
            return [];
        }

        $rows = DB::table('branch_stock as s')
            ->join('branches as b', 'b.id', '=', 's.branch_id')
            ->whereIn('s.product_id', $productIds)
            ->where('s.branch_id', '<>', $notAtBranchId)
            ->where('b.is_active', true)
            ->whereNull('b.deleted_at')
            ->groupBy('s.product_id', 'b.id', 'b.name', 'b.kind')
            ->havingRaw('sum(s.quantity) > 0')
            ->orderByRaw('sum(s.quantity) desc')
            ->get(['s.product_id', 'b.id as branch_id', 'b.name', 'b.kind', DB::raw('sum(s.quantity) as quantity')]);

        $held = [];
        foreach ($rows as $row) {
            $held[$row->product_id][] = [
                'branch_id' => $row->branch_id,
                'name' => $row->name,
                'kind' => $row->kind,
                'quantity' => (float) $row->quantity,
            ];
        }

        return $held;
    }
}
