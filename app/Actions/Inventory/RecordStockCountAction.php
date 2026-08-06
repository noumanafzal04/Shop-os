<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Write what was actually on the shelf.
 *
 * Counting is done in passes — a shelf at a time, often by different people —
 * so this takes any subset of lines and leaves the rest exactly as they were.
 * Recounting a line overwrites it: the second look is the one you trust.
 */
class RecordStockCountAction
{
    /**
     * @param  array<int, array{item_id: string, counted_quantity: float|int|null}>  $lines
     */
    public function execute(User $user, StockCount $count, array $lines): StockCount
    {
        if (! $count->isOpen()) {
            throw DomainException::conflict(
                'This count has been closed — figures can no longer be entered.',
                'STOCK_COUNT_CLOSED',
            );
        }

        return DB::transaction(function () use ($user, $count, $lines): StockCount {
            foreach ($lines as $line) {
                /** @var StockCountItem|null $item */
                $item = StockCountItem::query()
                    ->where('stock_count_id', $count->id)
                    ->whereKey($line['item_id'])
                    ->first();

                if ($item === null) {
                    throw DomainException::unprocessable(
                        'That line is not on this count sheet.',
                        'STOCK_COUNT_LINE_UNKNOWN',
                    );
                }

                $counted = $line['counted_quantity'];

                // Clearing a line puts it back to "nobody counted this", which
                // is not the same as counting zero — an empty shelf is a real
                // and different answer, and it must stay tellable.
                if ($counted === null || $counted === '') {
                    $item->forceFill([
                        'counted_quantity' => null,
                        'counted_at' => null,
                        'counted_by' => null,
                    ])->save();

                    continue;
                }

                if ((float) $counted < 0) {
                    throw DomainException::unprocessable(
                        'A shelf cannot hold less than nothing.',
                        'STOCK_COUNT_NEGATIVE',
                    );
                }

                $item->forceFill([
                    'counted_quantity' => round((float) $counted, 3),
                    'counted_at' => now(),
                    'counted_by' => $user->id,
                ])->save();
            }

            $count->forceFill([
                'lines_counted' => StockCountItem::query()
                    ->where('stock_count_id', $count->id)
                    ->whereNotNull('counted_quantity')
                    ->count(),
            ])->save();

            return $count->fresh();
        });
    }
}
