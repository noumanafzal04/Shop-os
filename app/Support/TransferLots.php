<?php

namespace App\Support;

use App\Models\ProductBatch;
use App\Models\StockMovement;
use Illuminate\Database\Eloquent\Builder;

/**
 * THE LOTS THAT TRAVEL WITH A TRANSFER.
 *
 * Lots are kept per place. A transfer took stock out of the sender's lots
 * (earliest expiry first, as every stock-out does) and then put the same
 * quantity into the receiver — into whichever lot there expired soonest, or
 * into none. So Panadol received in the warehouse under batch B-204, expiring
 * March, reached the branch as part of some other batch expiring in June, or
 * as stock with no date at all. The expiry fence, the recall list and the
 * near-expiry alert all read lots, and all three were then reading a date the
 * goods never had.
 *
 * Here the lots that left are written down on the transfer line, and put down
 * at the other end as THEMSELVES: same batch number, same dates, same cost.
 *
 * A line with no lots is stock that was never in one, and is left to the
 * ordinary stock-in rule.
 *
 * @phpstan-type Lot array{batch_number: string, expiry_date: ?string, manufactured_on: ?string, dot_code: ?string, cost: ?float, quantity: float}
 */
final class TransferLots
{
    /**
     * What a stock-out actually took, lot by lot, read off the movement that
     * took it — with each lot's own dates and cost, which the movement does
     * not carry and the batch row might not keep.
     *
     * @return list<Lot>
     */
    public static function takenBy(StockMovement $out): array
    {
        $allocations = $out->batch_allocations ?? [];
        if ($allocations === []) {
            return [];
        }

        $batches = ProductBatch::withoutTenancy()
            ->withTrashed()
            ->whereIn('id', array_column($allocations, 'batch_id'))
            ->get()
            ->keyBy('id');

        $lots = [];
        foreach ($allocations as $taken) {
            $batch = $batches->get($taken['batch_id'] ?? null);
            $lots[] = [
                'batch_number' => (string) ($taken['batch_number'] ?? $batch?->batch_number ?? ''),
                'expiry_date' => $taken['expiry_date'] ?? $batch?->expiry_date?->toDateString(),
                'manufactured_on' => $batch?->manufactured_on?->toDateString(),
                'dot_code' => $batch?->dot_code,
                'cost' => $batch?->cost === null ? null : (float) $batch->cost,
                'quantity' => round((float) $taken['quantity'], 3),
            ];
        }

        return $lots;
    }

    /**
     * The first `$quantity` of these lots, and what is left after it.
     *
     * In the order they were taken — earliest expiry first — so when less
     * arrives than left, it is the latest-dated stock that is counted missing.
     * Nobody at the receiving end is asked which lot the broken carton came
     * from, and guessing the other way would under-date what did arrive.
     *
     * @param  list<Lot>  $lots
     * @return array{0: list<Lot>, 1: list<Lot>}
     */
    public static function split(array $lots, float $quantity): array
    {
        $first = [];
        $rest = [];
        $left = round($quantity, 3);

        foreach ($lots as $lot) {
            $take = min((float) $lot['quantity'], max(0.0, $left));
            if ($take > 0) {
                $first[] = ['quantity' => round($take, 3)] + $lot;
                $left = round($left - $take, 3);
            }
            $over = round((float) $lot['quantity'] - $take, 3);
            if ($over > 0) {
                $rest[] = ['quantity' => $over] + $lot;
            }
        }

        return [$first, $rest];
    }

    /** A date column matched as a DATE, or as "has none" — never as a string. */
    private static function onDate(Builder $query, string $column, ?string $date): void
    {
        $date === null ? $query->whereNull($column) : $query->whereDate($column, $date);
    }

    /**
     * Put lots down at a place. A lot that is already there — same number,
     * same dates — gains the quantity; otherwise it is opened there.
     *
     * The stock figure itself is the caller's to move (through
     * `InventoryService`, with `lots_placed`), so the shelf and its lots are
     * written in the same transaction and cannot drift.
     *
     * @param  list<Lot>  $lots
     */
    public static function putDown(string $tenantId, string $branchId, string $productId, ?string $variantId, array $lots): void
    {
        foreach ($lots as $lot) {
            if ((float) $lot['quantity'] <= 0) {
                continue;
            }

            $there = ProductBatch::withoutTenancy()
                ->where('tenant_id', $tenantId)
                ->where('branch_id', $branchId)
                ->where('product_id', $productId)
                ->where('variant_id', $variantId)
                ->where('batch_number', $lot['batch_number'])
                ->tap(fn ($q) => self::onDate($q, 'expiry_date', $lot['expiry_date']))
                ->tap(fn ($q) => self::onDate($q, 'manufactured_on', $lot['manufactured_on']))
                ->lockForUpdate()
                ->first();

            if ($there !== null) {
                $there->update(['quantity' => round((float) $there->quantity + (float) $lot['quantity'], 3)]);

                continue;
            }

            ProductBatch::withoutTenancy()->create([
                'tenant_id' => $tenantId,
                'branch_id' => $branchId,
                'product_id' => $productId,
                'variant_id' => $variantId,
                'batch_number' => $lot['batch_number'],
                'expiry_date' => $lot['expiry_date'],
                'manufactured_on' => $lot['manufactured_on'],
                'dot_code' => $lot['dot_code'],
                'cost' => $lot['cost'],
                'quantity' => round((float) $lot['quantity'], 3),
            ]);
        }
    }
}
