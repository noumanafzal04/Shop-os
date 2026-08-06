<?php

namespace App\Actions\Inventory;

use App\Enums\ItemType;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Models\User;
use App\Support\DocumentCounter;
use Illuminate\Support\Facades\DB;

/**
 * Draw the count sheet.
 *
 * Every line captures what the system believes RIGHT NOW, and that snapshot is
 * the whole point: the shop keeps selling while it counts, so the figure the
 * counter is measured against has to be frozen at the moment the sheet was
 * printed. Compare a count taken at 9pm against stock as it stands at midnight
 * and every evening's sales read as shrinkage.
 */
class StartStockCountAction
{
    /**
     * @param array{branch_id?: ?string, scope?: string, category_id?: ?string,
     *              blind?: bool, notes?: ?string} $data
     */
    public function execute(User $user, string $tenantId, array $data): StockCount
    {
        return DB::transaction(function () use ($user, $tenantId, $data): StockCount {
            $branchId = $data['branch_id'] ?? null;

            // Two counts open on the same shelves at once produce two sets of
            // expectations and one of them is guaranteed to be wrong by the
            // time it is applied.
            $open = StockCount::query()
                ->where('status', StockCount::STATUS_COUNTING)
                ->where('branch_id', $branchId)
                ->first();

            if ($open !== null) {
                throw DomainException::conflict(
                    "A count is already open for this branch ({$open->reference}). Finish or cancel it first.",
                    'STOCK_COUNT_OPEN',
                );
            }

            $count = StockCount::query()->create([
                'branch_id' => $branchId,
                'reference' => DocumentCounter::formatted($tenantId, 'stock_count', 'SC'),
                'status' => StockCount::STATUS_COUNTING,
                'scope' => $data['scope'] ?? 'all',
                'category_id' => $data['category_id'] ?? null,
                'blind' => $data['blind'] ?? true,
                'notes' => $data['notes'] ?? null,
                'started_by' => $user->id,
                'started_at' => now(),
                'lines_total' => 0,
                'lines_counted' => 0,
            ]);

            $lines = $this->drawSheet($tenantId, $count);

            if ($lines === 0) {
                throw DomainException::unprocessable(
                    'Nothing to count — no stock-tracked items match that scope.',
                    'STOCK_COUNT_EMPTY',
                );
            }

            $count->forceFill(['lines_total' => $lines])->save();

            return $count->fresh(['branch', 'category', 'startedBy']);
        });
    }

    /** @return int the number of lines drawn */
    private function drawSheet(string $tenantId, StockCount $count): int
    {
        // Services hold no stock, and an item nobody asked us to track has no
        // expectation to measure against — neither belongs on a count sheet.
        $products = Product::query()
            ->where('tenant_id', $tenantId)
            ->where('type', ItemType::Product)
            ->where('track_inventory', true)
            ->where('is_active', true)
            ->when(
                $count->scope === 'category' && $count->category_id !== null,
                fn ($q) => $q->where('category_id', $count->category_id),
            )
            ->with('variants:id,product_id,name,sku,stock_quantity')
            ->orderBy('name')
            ->get(['id', 'tenant_id', 'name', 'sku', 'cost', 'stock_quantity']);

        if ($products->isEmpty()) {
            return 0;
        }

        // InventoryService seeds a MISSING branch_stock row from the legacy
        // rollup on the default branch only; every other branch starts empty.
        // The sheet has to read stock the same way the adjust will write it, or
        // the first count at a new branch invents a variance for every line.
        $isDefaultBranch = Branch::query()
            ->whereKey($count->branch_id)
            ->value('is_default') ?? false;

        // On-hand per branch is the source of truth; one query for the lot
        // rather than a lookup per line.
        $onHand = BranchStock::query()
            ->where('branch_id', $count->branch_id)
            ->whereIn('product_id', $products->pluck('id'))
            ->get(['product_id', 'variant_id', 'quantity'])
            ->keyBy(fn (BranchStock $row): string => $row->product_id.'|'.($row->variant_id ?? ''));

        $rows = [];
        $now = now();
        // insert() bypasses model events, so the ids come from the model's own
        // generator rather than a second opinion about what a uuid is here.
        $template = new StockCountItem;
        $newId = fn (): string => (string) $template->newUniqueId();

        foreach ($products as $product) {
            // A product WITH variants holds no stock of its own — each variant
            // is its own shelf and gets its own line.
            $targets = $product->variants->isNotEmpty()
                ? $product->variants->map(fn ($v): array => [
                    'variant_id' => $v->id,
                    'variant_name' => $v->name,
                    'sku' => $v->sku ?: $product->sku,
                    'fallback' => (float) $v->stock_quantity,
                ])->all()
                : [[
                    'variant_id' => null,
                    'variant_name' => null,
                    'sku' => $product->sku,
                    'fallback' => (float) $product->stock_quantity,
                ]];

            foreach ($targets as $target) {
                $key = $product->id.'|'.($target['variant_id'] ?? '');
                $expected = isset($onHand[$key])
                    ? (float) $onHand[$key]->quantity
                    : ($isDefaultBranch ? $target['fallback'] : 0.0);

                $rows[] = [
                    'id' => $newId(),
                    'tenant_id' => $tenantId,
                    'stock_count_id' => $count->id,
                    'product_id' => $product->id,
                    'variant_id' => $target['variant_id'],
                    'product_name' => $product->name,
                    'variant_name' => $target['variant_name'],
                    'sku' => $target['sku'],
                    'expected_quantity' => round($expected, 3),
                    'counted_quantity' => null,
                    'unit_cost' => round((float) $product->cost, 2),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        foreach (array_chunk($rows, 500) as $chunk) {
            StockCountItem::query()->insert($chunk);
        }

        return count($rows);
    }
}
