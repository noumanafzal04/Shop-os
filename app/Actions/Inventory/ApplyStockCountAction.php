<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Post the count.
 *
 * The one decision this whole feature turns on: a count is applied as the
 * VARIANCE — a delta — never as the counted figure itself.
 *
 * The sheet said 50 at 9pm. The counter found 48, so two are missing. By the
 * time a manager signs it off at 10pm the shop has sold three more and the
 * system says 45. Writing "set 48" would invent three units back into stock and
 * quietly erase an hour of trade. Writing "−2" leaves 43, which is the truth.
 *
 * That is also why an uncounted line is skipped rather than zeroed: nobody
 * reached that shelf, and writing off everything the counter ran out of time
 * for is the fastest way to make a shop stop trusting stocktakes altogether.
 */
class ApplyStockCountAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    public function execute(User $user, StockCount $count, ?string $notes = null): StockCount
    {
        return DB::transaction(function () use ($user, $count, $notes): StockCount {
            /** @var StockCount $locked */
            $locked = StockCount::query()->whereKey($count->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw DomainException::conflict(
                    'This count has already been applied.',
                    'STOCK_COUNT_CLOSED',
                );
            }

            $items = StockCountItem::query()
                ->where('stock_count_id', $locked->id)
                ->whereNotNull('counted_quantity')
                ->get();

            if ($items->isEmpty()) {
                throw DomainException::unprocessable(
                    'Nothing has been counted yet.',
                    'STOCK_COUNT_EMPTY',
                );
            }

            $units = 0.0;
            $value = 0.0;

            foreach ($items as $item) {
                $variance = $item->variance();
                $units += $variance;
                $value += $item->varianceValue();

                // A line that matched needs no movement. Writing a zero-delta
                // adjustment would bury the real corrections in a stock history
                // nobody can then read.
                if (abs($variance) < 0.0005) {
                    continue;
                }

                $this->inventory->adjust([
                    'product_id' => $item->product_id,
                    'variant_id' => $item->variant_id,
                    'branch_id' => $locked->branch_id,
                    'type' => $variance > 0 ? 'in' : 'out',
                    'quantity' => abs($variance),
                    'reason' => "Stock count {$locked->reference}",
                    'reference_type' => 'stock_count',
                    'reference_id' => $locked->id,
                    // Applying the same sheet twice is stopped by the status
                    // guard above; the key makes a retried REQUEST harmless too.
                    'idempotency_key' => "stock_count:{$locked->id}:{$item->id}",
                    // A count is the authority on what is there. If it says the
                    // shelf holds less than the system's already-negative
                    // figure, that is the finding — it must not be refused.
                    'allow_negative' => true,
                ]);
            }

            $locked->forceFill([
                'status' => StockCount::STATUS_APPLIED,
                'applied_by' => $user->id,
                'applied_at' => now(),
                // Frozen here and never recomputed: what a manager signed off on
                // must still read the same after the stock has moved on.
                'variance_units' => round($units, 3),
                'variance_value' => round($value, 2),
                'notes' => $notes ?? $locked->notes,
            ])->save();

            return $locked->fresh(['branch', 'appliedBy', 'startedBy']);
        });
    }
}
