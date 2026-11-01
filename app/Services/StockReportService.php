<?php

namespace App\Services;

use App\Enums\ItemType;
use App\Enums\SaleStatus;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\StockTransfer;
use Generator;
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
    /**
     * HOW MANY LINES A SCREEN IS SENT.
     *
     * The totals and the category split are computed over EVERYTHING and
     * always will be — a valuation that misses a shelf is worse than a slow
     * one. What was being shipped as well was every line: 6,000 of them,
     * **1.14 MB in one response** on a load-test grocery, to a screen that
     * renders the first hundred and throws the rest away.
     *
     * On a shop's phone that is the difference between a report and a hang,
     * and it grows with the catalogue. The CSV export calls the same service
     * and passes null, because the whole list is exactly what an export is
     * for.
     */
    public const SCREEN_LINES = 200;

    /** How far past the screen's lines a list may grow before it is cut back. */
    private const SORT_EVERY = 2000;

    public function valuation(string $tenantId, ?string $branchId = null, ?int $limit = self::SCREEN_LINES): array
    {
        // STOCK ON THE ROAD IS STILL THE SHOP'S. A transfer takes the units off
        // the sender at Send and puts them on the receiver at Receive; nothing
        // held them in between, so the shop's stock value dropped by whatever
        // was on the van for as long as it travelled (retail #14). It is
        // neither place's, so a branch's own figure leaves it out — the
        // shop-wide one counts it, and says how much of it is travelling.
        $road = $branchId === null ? $this->onTheRoad($tenantId) : collect();
        $roadUnits = 0.0;
        $roadCost = 0.0;
        $travelling = [];
        foreach ($road as $moving) {
            $roadUnits += (float) $moving->quantity;
            $roadCost += (float) $moving->quantity * max(0.0, (float) ($moving->cost ?? 0));
            $travelling[$moving->product_id.'|'.($moving->variant_id ?? '')] = $moving;
        }

        // The road onto the product's own line when it has one, as a line of
        // its own when every unit of it is travelling — added as the shelf
        // goes by, one row at a time.
        $rows = (function () use ($tenantId, $branchId, &$travelling): Generator {
            foreach ($this->onHand($tenantId, $branchId) as $row) {
                $key = $row->product_id.'|'.($row->variant_id ?? '');
                if (isset($travelling[$key])) {
                    $row->quantity = (float) $row->quantity + (float) $travelling[$key]->quantity;
                    unset($travelling[$key]);
                }

                yield $row;
            }

            yield from array_values($travelling);
        })();

        $costValue = 0.0;
        $retailValue = 0.0;
        $units = 0.0;
        $uncosted = 0;
        $uncostedUnits = 0.0;
        $byCategory = [];
        $items = [];
        $lines = 0;

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

            $lines++;
            $items[] = [
                'product_id' => $row->product_id,
                'variant_id' => $row->variant_id,
                'name' => $row->variant_name ? "{$row->product_name} · {$row->variant_name}" : $row->product_name,
                'sku' => $row->variant_sku ?: $row->sku,
                'category' => $row->category_name ?? 'Uncategorized',
                'quantity' => round($qty, 3),
                'cost' => $cost === null ? null : round($cost, 2),
                'cost_value' => round($qty * ($cost ?? 0), 2),
                'retail_value' => round($qty * $retail, 2),
            ];
            if ($limit !== null && count($items) >= $limit + self::SORT_EVERY) {
                $items = self::mostFirst($items, 'cost_value', $limit);
            }
        }

        $shown = self::mostFirst($items, 'cost_value', $limit);

        return [
            'branch_scope' => $branchId,
            'totals' => [
                'lines' => $lines,
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
                // Already inside the figures above, named so the places and the
                // road add up in front of the reader.
                'on_the_road_units' => round($roadUnits, 3),
                'on_the_road_cost' => round($roadCost, 2),
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
            // Said out loud rather than silently truncated: a list that stops
            // at two hundred and does not say so is a list a shopkeeper
            // believes is the whole shelf.
            'items' => $shown,
            'items_shown' => count($shown),
            'items_total' => $lines,
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
    public function deadStock(string $tenantId, ?string $branchId, int $days = 90, ?int $limit = self::SCREEN_LINES): array
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
        $lines = 0;
        $neverSold = 0;

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
            $lines++;
            $neverSold += $lastAt === null ? 1 : 0;
            if ($limit !== null && count($items) >= $limit + self::SORT_EVERY) {
                $items = self::mostFirst($items, 'value', $limit);
            }
        }

        // Sorted by VALUE before the cap, so the two hundred lines a screen
        // is sent are the two hundred worth the most — the shelf holding
        // Rs 80,000 of unsold stock, not whichever rows the query returned
        // first.
        $shown = self::mostFirst($items, 'value', $limit);

        return [
            'branch_scope' => $branchId,
            'days' => $days,
            'totals' => [
                'lines' => $lines,
                'units' => round($units, 3),
                'value' => round($value, 2),
                'never_sold' => $neverSold,
            ],
            'items' => $shown,
            'items_shown' => count($shown),
            'items_total' => $lines,
        ];
    }

    /**
     * On-hand per stock target, with the catalog fields a valuation needs.
     *
     * A product WITH variants holds no stock of its own — each variant is its
     * own line. When no branch is named the branch rows are summed, which is
     * the same figure the product rollup carries but without trusting it.
     *
     * ONE ROW AT A TIME (#GS6). The 50k garments shop held all 50,010 shelf
     * rows as objects (52 MB) and every line valued again as an array (34 MB)
     * to show two hundred — 295 MB in all, past the server's 128. The rows
     * now come off a cursor, and each report keeps its totals as it goes and
     * only the lines it will send.
     *
     * @return Generator<int, object>
     */
    private function onHand(string $tenantId, ?string $branchId): Generator
    {
        $defaultBranchId = Branch::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->where('is_default', true)
            ->value('id');

        // ADDED UP FIRST, NAMED AFTER.
        //
        // This was one query that joined every shelf row to its product, its
        // size and its category and THEN grouped — by eleven columns, nine of
        // them text, so that the names could ride along. On a shop of six
        // thousand items the database built and sorted that whole wide table
        // to add up one number a row: 230 ms of a 570 ms report.
        //
        // The shelf is summed on its own two ids, and the handful of names are
        // joined to the answer. Same rows, same figures.
        $onShelf = BranchStock::withoutTenancy()
            ->where('branch_stock.tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('branch_stock.branch_id', $branchId))
            ->groupBy('branch_stock.product_id', 'branch_stock.variant_id')
            ->selectRaw('branch_stock.product_id, branch_stock.variant_id, SUM(branch_stock.quantity) as quantity');

        $stock = DB::query()
            ->fromSub($onShelf, 'branch_stock')
            ->join('products', 'products.id', '=', 'branch_stock.product_id')
            ->leftJoin('product_variants', 'product_variants.id', '=', 'branch_stock.variant_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            // The shop's OWN products, said out loud. The join already keeps
            // other shops' rows out of the answer — but with nothing here to
            // start from, the database read the product table of EVERY shop
            // on the platform to find this one's. A report that slows down as
            // other shops sign up.
            ->where('products.tenant_id', $tenantId)
            ->whereNull('products.deleted_at')
            ->where('products.type', ItemType::Product->value)
            ->where('products.track_inventory', true)
            ->selectRaw(implode(', ', [
                'branch_stock.product_id as product_id',
                'branch_stock.variant_id as variant_id',
                'branch_stock.quantity as quantity',
                'products.name as product_name',
                'products.sku as sku',
                'product_variants.name as variant_name',
                'product_variants.sku as variant_sku',
                // A variant carries its own price, and may carry its own cost —
                // fall back to the parent's rather than valuing it at nothing.
                'COALESCE(product_variants.cost, products.cost) as cost',
                'COALESCE(product_variants.price, products.price) as price',
                'categories.name as category_name',
            ]));

        yield from $stock->cursor();

        // Products that have never moved have no branch_stock row at all. On the
        // default branch their stock still lives in the legacy rollup, and a
        // valuation that skipped them would under-report the shelves — which is
        // the one direction a stock valuation must never be wrong in.
        if ($branchId === null || $branchId === $defaultBranchId) {
            // ONLY THE ONES WITH NO SHELF ROW, ASKED OF THE DATABASE (#GS6).
            // This loaded every item with stock as a full model — 50,002 on the
            // 50k garments shop — and then looked each one up in a list of
            // every shelf row, one by one: 295 MB and a fifty-thousand-squared
            // scan, to keep the handful that had never moved. The same "has a
            // shelf row of its own here" is now a NOT EXISTS, and what comes
            // back is plain rows.
            $orphans = Product::query()
                ->where('products.tenant_id', $tenantId)
                ->where('products.type', ItemType::Product)
                ->where('products.track_inventory', true)
                ->where('products.stock_quantity', '>', 0)
                ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
                ->doesntHave('variants')
                ->whereNotExists(fn ($shelf) => $shelf->selectRaw('1')
                    ->from('branch_stock')
                    ->whereColumn('branch_stock.product_id', 'products.id')
                    ->whereNull('branch_stock.variant_id')
                    ->where('branch_stock.tenant_id', $tenantId)
                    ->when($branchId, fn ($q) => $q->where('branch_stock.branch_id', $branchId)))
                ->select([
                    'products.id as product_id', 'products.name as product_name', 'products.sku as sku',
                    'products.cost as cost', 'products.price as price', 'products.stock_quantity as quantity',
                    'categories.name as category_name',
                ])
                ->toBase();

            foreach ($orphans->cursor() as $orphan) {
                $orphan->variant_id = null;
                $orphan->variant_name = null;
                $orphan->variant_sku = null;

                yield $orphan;
            }
        }
    }

    /**
     * Sent and not yet counted in, by product and size, with what the
     * valuation needs to price it.
     *
     * @return Collection<int, object>
     */
    private function onTheRoad(string $tenantId): Collection
    {
        return DB::table('stock_transfer_items as i')
            ->join('stock_transfers as t', 't.id', '=', 'i.stock_transfer_id')
            ->join('products', 'products.id', '=', 'i.product_id')
            ->leftJoin('product_variants', 'product_variants.id', '=', 'i.variant_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->where('t.tenant_id', $tenantId)
            ->where('t.status', StockTransfer::IN_TRANSIT)
            ->whereNull('t.deleted_at')
            ->whereNull('products.deleted_at')
            ->where('products.type', ItemType::Product->value)
            ->where('products.track_inventory', true)
            ->groupBy('i.product_id', 'i.variant_id', 'products.name', 'products.sku', 'product_variants.name',
                'product_variants.sku', 'product_variants.cost', 'products.cost', 'product_variants.price',
                'products.price', 'categories.name')
            ->get([
                'i.product_id as product_id',
                'i.variant_id as variant_id',
                DB::raw('SUM(i.quantity) as quantity'),
                'products.name as product_name',
                'products.sku as sku',
                'product_variants.name as variant_name',
                'product_variants.sku as variant_sku',
                DB::raw('COALESCE(product_variants.cost, products.cost) as cost'),
                DB::raw('COALESCE(product_variants.price, products.price) as price'),
                'categories.name as category_name',
            ]);
    }

    /**
     * The lines worth the most, first — at most `$limit` of them (all, when
     * null). A stable sort, so lines worth the same keep the order they came
     * in; called on a growing list every SORT_EVERY lines, it holds a few
     * thousand lines at a time instead of the whole shelf, and still keeps
     * exactly the ones one sort of everything would.
     *
     * @param  array<int, array<string, mixed>>  $items
     * @return array<int, array<string, mixed>>
     */
    private static function mostFirst(array $items, string $by, ?int $limit): array
    {
        usort($items, fn (array $a, array $b): int => $b[$by] <=> $a[$by]);

        return $limit === null ? $items : array_slice($items, 0, $limit);
    }
}
