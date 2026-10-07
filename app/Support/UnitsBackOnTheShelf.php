<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * PUT BACK ON THE SHELF THE UNITS THAT CAME BACK BEFORE ANYBODY SAID WHICH.
 *
 * Until 2026-10-07 the returns desk never said which numbered unit came back:
 * it sent a quantity, the server only freed a unit it was told the number of,
 * and so every phone that was refunded or exchanged stayed `sold` under its
 * number. Standing on the shelf, it was refused at the till as "already sold"
 * — for ever, because no door could free it once the sale had been refunded.
 *
 * The return now works it out (`ProcessSaleReturnAction::unitsComingBack`).
 * This mends what the old desk left behind, and only what can be KNOWN:
 *
 *   a line that has come back in full — every unit on it is back, whichever
 *   order they came in
 *
 *   a registry row marked `sold` that no standing sale is holding — nobody
 *   has it
 *
 * A line that came back in PART, with no number said, is left alone: one of
 * its units is back and nothing on record says which. That is the shop's to
 * settle, at the warranty desk, with the box in its hand.
 *
 * Idempotent, and safe to run any time: it only ever moves a unit TO where
 * the sales say it is.
 */
final class UnitsBackOnTheShelf
{
    /** The statuses a sale stands in while its units are with the customer. */
    private const STANDING = ['completed', 'partially_refunded'];

    /** @return array{units_back: int, back_on_shelf: int} */
    public static function repair(): array
    {
        return DB::transaction(fn () => [
            'units_back' => self::linesBackInFull(),
            'back_on_shelf' => self::heldByNobody(),
        ]);
    }

    /** Units on a line that has come back in full, still recorded as out. */
    private static function linesBackInFull(): int
    {
        $lines = DB::table('sale_item_serials')
            ->whereNull('returned_at')
            ->whereNotNull('sale_item_id')
            ->distinct()
            ->pluck('sale_item_id');

        $mended = 0;
        foreach ($lines as $lineId) {
            $sold = (float) DB::table('sale_items')->where('id', $lineId)->value('quantity');
            $back = DB::table('sale_return_items as r')
                ->join('sale_returns as h', 'h.id', '=', 'r.sale_return_id')
                ->where('r.sale_item_id', $lineId)
                ->selectRaw('COALESCE(SUM(r.quantity), 0) as qty, MAX(h.returned_at) as last_at')
                ->first();

            if ($sold <= 0 || (float) $back->qty + 0.0005 < $sold) {
                continue;
            }

            $mended += DB::table('sale_item_serials')
                ->where('sale_item_id', $lineId)
                ->whereNull('returned_at')
                ->update(['returned_at' => $back->last_at ?? now(), 'updated_at' => now()]);
        }

        return $mended;
    }

    /** Registry rows marked sold that no standing sale holds. */
    private static function heldByNobody(): int
    {
        $mended = 0;

        DB::table('product_serials')
            ->where('status', 'sold')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->select(['id', 'tenant_id', 'product_id', 'serial'])
            ->chunk(500, function ($rows) use (&$mended): void {
                foreach ($rows as $row) {
                    $held = DB::table('sale_item_serials as s')
                        ->join('sales as x', 'x.id', '=', 's.sale_id')
                        // Implied by the product; said so the (tenant, serial) index is used.
                        ->where('s.tenant_id', $row->tenant_id)
                        ->where('s.product_id', $row->product_id)
                        ->where('s.serial', $row->serial)
                        ->whereNull('s.returned_at')
                        ->whereIn('x.status', self::STANDING)
                        ->exists();

                    if (! $held) {
                        $mended += DB::table('product_serials')
                            ->where('id', $row->id)
                            ->update(['status' => 'in_stock', 'sale_id' => null, 'updated_at' => now()]);
                    }
                }
            });

        return $mended;
    }
}
