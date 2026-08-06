<?php

namespace App\Services;

use App\Enums\ItemType;
use App\Enums\SaleStatus;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What the shelves are worth, and what on them is not moving.
 *
 * Two questions a stock-carrying shop cannot otherwise answer:
 *
 *   "How much money am I standing in?" — the figure a shopkeeper needs at
 *   audit, at a bank meeting, and every time they wonder why the till is busy
 *   and the account is empty.
 *
 *   "What have I been carrying for eight months?" — dead stock is the quietest
 *   way a shop loses cash. Nothing prompts you to look at a shelf nobody buys
 *   from; it just sits there, paid for.
 */
class StockReportService
{
    /**
     * Stock on hand, valued.
     *
     * Cost is what the shop paid; retail is what it hopes to get. Items with no
     * cost recorded are counted SEPARATELY rather than valued at zero — a
     * valuation that silently treats uncosted stock as worthless is worse than
     * one that admits the gap.
     *
     * @return array<string, mixed>
     */
    public function valuation(string $tenantId, ?string $branchId = null): array
    {
        $rows = $this->onHand($tenantId, $branchId);

        $costValue = 0.0;
        $retailValue = 0.0;
        $units = 0.0;
        $uncosted = 0;
        $uncostedUnits = 0.0;
        $byCategory = [];

        foreach ($rows as $row) {
            $qty = (float) $row->quantity;
            if ($qty <= 0) {
                continue;
            }

            $cost = $row->cost === null ? null : (float) $row->cost;
            $retail = (float) $row->price;

            $units += $qty;
            $retailValue += $qty * $retail;

            if ($cost === null || $cost <= 0) {
                $uncosted++;
                $uncostedUnits += $qty;
            } else {
                $costValue += $qty * $cost;
            }

            $key = $row->category_name ?? 'Uncategorized';
            $byCategory[$key] ??= ['category' => $key, 'units' => 0.0, 'cost_value' => 0.0, 'retail_value' => 0.0];
            $byCategory[$key]['units'] += $qty;
            $byCategory[$key]['cost_value'] += $qty * ($cost ?? 0);
            $byCategory[$key]['retail_value'] += $qty * $retail;
        }

        $items = $this->valuedItems($rows);

        return [
            'branch_scope' => $branchId,
            'totals' => [
                'lines' => count($items),
                'units' => round($units, 3),
                'cost_value' => round($costValue, 2),
                'retail_value' => round($retailValue, 2),
                // What the shelves would earn if every unit sold at list.
                'potential_profit' => round($retailValue - $costValue, 2),
                // Stated, not hidden: these units are in the retail figure but
                // not the cost one, so the margin above is optimistic by
                // however much they actually cost.
                'uncosted_items' => $uncosted,
                'uncosted_units' => round($uncostedUnits, 3),
            ],
            'by_category' => collect($byCategory)
                ->map(fn (array $c): array => [
                    'category' => $c['category'],
                    'units' => round($c['units'], 3),
                    'cost_value' => round($c['cost_value'], 2),
                    'retail_value' => round($c['retail_value'], 2),
                ])
                ->sortByDesc('cost_value')
                ->values()
                ->all(),
            'items' => $items,
        ];
    }

    /**
     * Stock nobody has bought.
     *
     * "Never sold" and "sold once, ten months ago" are different problems, so
     * `last_sold_at` is kept rather than collapsed into a single flag. Sorted by
     * what it is worth — the shelf holding Rs 80,000 of unsold stock matters
     * more than the one holding Rs 300, however long both have sat.
     *
     * @return array<string, mixed>
     */
    public function deadStock(string $tenantId, ?string $branchId, int $days = 90): array
    {
        $cutoff = now()->subDays($days);

        $rows = $this->onHand($tenantId, $branchId);

        // One grouped query for every product's last sale, rather than a
        // lookup per line — a shop with 4,000 SKUs must not cost 4,000 queries.
        $lastSold = DB::table('sale_items')
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sale_items.tenant_id', $tenantId)
            ->whereNull('sales.deleted_at')
            ->whereIn('sales.status', [SaleStatus::Completed->value, SaleStatus::PartiallyRefunded->value])
            ->when($branchId, fn ($q) => $q->where('sales.branch_id', $branchId))
            ->groupBy('sale_items.product_id')
            ->pluck(DB::raw('MAX(sales.sold_at) as last_sold'), 'sale_items.product_id');

        $items = [];
        $value = 0.0;
        $units = 0.0;

        foreach ($rows as $row) {
            $qty = (float) $row->quantity;
            if ($qty <= 0) {
                continue;
            }

            $last = $lastSold[$row->product_id] ?? null;
            $lastAt = $last === null ? null : Carbon::parse($last);

            if ($lastAt !== null && $lastAt->greaterThan($cutoff)) {
                continue;   // It moved recently. Not dead.
            }

            $cost = (float) ($row->cost ?? 0);
            $lineValue = round($qty * $cost, 2);
            $value += $lineValue;
            $units += $qty;

            $items[] = [
                'product_id' => $row->product_id,
                'variant_id' => $row->variant_id,
                'name' => $row->variant_name ? "{$row->product_name} · {$row->variant_name}" : $row->product_name,
                'sku' => $row->variant_sku ?: $row->sku,
                'category' => $row->category_name ?? 'Uncategorized',
                'quantity' => round($qty, 3),
                'cost' => round($cost, 2),
                'value' => $lineValue,
                'last_sold_at' => $lastAt?->toDateString(),
                // Null when it has NEVER sold — a different problem from slow,
                // and usually a buying mistake rather than a selling one.
                'days_idle' => $lastAt?->diffInDays(now()),
            ];
        }

        usort($items, fn (array $a, array $b): int => $b['value'] <=> $a['value']);

        return [
            'branch_scope' => $branchId,
            'days' => $days,
            'totals' => [
                'lines' => count($items),
                'units' => round($units, 3),
                'value' => round($value, 2),
                'never_sold' => count(array_filter($items, fn (array $i): bool => $i['last_sold_at'] === null)),
            ],
            'items' => $items,
        ];
    }

    /**
     * On-hand per stock target, with the catalog fields a valuation needs.
     *
     * A product WITH variants holds no stock of its own — each variant is its
     * own line. When no branch is named the branch rows are summed, which is
     * the same figure the product rollup carries but without trusting it.
     *
     * @return Collection<int, object>
     */
    private function onHand(string $tenantId, ?string $branchId)
    {
        $defaultBranchId = Branch::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_default', true)
            ->value('id');

        $stock = BranchStock::withoutTenancy()
            ->where('branch_stock.tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('branch_stock.branch_id', $branchId))
            ->join('products', 'products.id', '=', 'branch_stock.product_id')
            ->leftJoin('product_variants', 'product_variants.id', '=', 'branch_stock.variant_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->whereNull('products.deleted_at')
            ->where('products.type', ItemType::Product->value)
            ->where('products.track_inventory', true)
            ->groupBy(
                'branch_stock.product_id', 'branch_stock.variant_id',
                'products.name', 'products.sku', 'products.cost', 'products.price',
                'product_variants.name', 'product_variants.sku', 'product_variants.cost', 'product_variants.price',
                'categories.name',
            )
            ->selectRaw(implode(', ', [
                'branch_stock.product_id as product_id',
                'branch_stock.variant_id as variant_id',
                'SUM(branch_stock.quantity) as quantity',
                'products.name as product_name',
                'products.sku as sku',
                'product_variants.name as variant_name',
                'product_variants.sku as variant_sku',
                // A variant carries its own price, and may carry its own cost —
                // fall back to the parent's rather than valuing it at nothing.
                'COALESCE(product_variants.cost, products.cost) as cost',
                'COALESCE(product_variants.price, products.price) as price',
                'categories.name as category_name',
            ]))
            ->get();

        // Products that have never moved have no branch_stock row at all. On the
        // default branch their stock still lives in the legacy rollup, and a
        // valuation that skipped them would under-report the shelves — which is
        // the one direction a stock valuation must never be wrong in.
        if ($branchId === null || $branchId === $defaultBranchId) {
            $seen = $stock->map(fn ($r): string => $r->product_id.'|'.($r->variant_id ?? ''))->all();

            $orphans = Product::query()
                ->where('products.tenant_id', $tenantId)
                ->where('products.type', ItemType::Product)
                ->where('products.track_inventory', true)
                ->where('products.stock_quantity', '>', 0)
                ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
                ->doesntHave('variants')
                ->get([
                    'products.id as product_id', 'products.name as product_name', 'products.sku as sku',
                    'products.cost as cost', 'products.price as price', 'products.stock_quantity as quantity',
                    'categories.name as category_name',
                ]);

            foreach ($orphans as $orphan) {
                if (in_array($orphan->product_id.'|', $seen, strict: true)) {
                    continue;
                }
                $orphan->variant_id = null;
                $orphan->variant_name = null;
                $orphan->variant_sku = null;
                $stock->push($orphan);
            }
        }

        return $stock;
    }

    /**
     * @param  Collection<int, object>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function valuedItems($rows): array
    {
        $items = $rows
            ->filter(fn ($row): bool => (float) $row->quantity > 0)
            ->map(function ($row): array {
                $qty = (float) $row->quantity;
                $cost = $row->cost === null ? null : (float) $row->cost;

                return [
                    'product_id' => $row->product_id,
                    'variant_id' => $row->variant_id,
                    'name' => $row->variant_name ? "{$row->product_name} · {$row->variant_name}" : $row->product_name,
                    'sku' => $row->variant_sku ?: $row->sku,
                    'category' => $row->category_name ?? 'Uncategorized',
                    'quantity' => round($qty, 3),
                    'cost' => $cost === null ? null : round($cost, 2),
                    'cost_value' => round($qty * ($cost ?? 0), 2),
                    'retail_value' => round($qty * (float) $row->price, 2),
                ];
            })
            ->values()
            ->all();

        usort($items, fn (array $a, array $b): int => $b['cost_value'] <=> $a['cost_value']);

        return $items;
    }
}
