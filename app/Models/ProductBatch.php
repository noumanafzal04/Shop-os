<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Support\DotCode;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A batch/lot of stock. Batch quantities live under the product's
 * stock_quantity; sales deplete FEFO.
 *
 * It carries two different kinds of date, and the difference matters:
 *
 *  - `expiry_date` is a fence. A medicine past it may not be dispensed, and
 *    the platform blocks it.
 *  - `manufactured_on` (from a tyre's DOT code) is an AGE. Nothing becomes
 *    illegal on a given day; rubber simply ages on the shelf whether or not
 *    anyone drives on it. The shop needs to see how old a lot is, sell the
 *    oldest first, and be warned before a customer asks — never to be stopped
 *    from making a sale it is entitled to make.
 */
class ProductBatch extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'expiry_date' => 'date',
            'manufactured_on' => 'date',
            'quantity' => 'decimal:3',
            'cost' => 'decimal:2',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** The specific variant this lot belongs to, or null for product-level lots. */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class);
    }

    /** How old this lot is, and how a counter should read that. */
    public function ageStatus(int $warnYears = 5, int $oldYears = 6): ?string
    {
        return DotCode::status($this->manufactured_on, $warnYears, $oldYears);
    }

    public function humanAge(): ?string
    {
        return DotCode::humanAge($this->manufactured_on);
    }

    /**
     * The order stock leaves a shelf: oldest risk first.
     *
     * ── Why it is not just expiry ───────────────────────────────────────
     *
     * FEFO sorted on `expiry_date` alone, and a tyre has none. So every lot in
     * a tyre shop tied, the database returned them in whatever order it liked —
     * in practice the order they were received — and the newest pallet went out
     * of the door while the 2019 set aged quietly behind it. `DotCode` states
     * the requirement in its own docblock ("a shop needs to see the age, sell
     * the oldest stock first") and nothing implemented it.
     *
     * ── The order, and why this order ───────────────────────────────────
     *
     *  1. dated lots before undated ones, then soonest expiry first
     *     — an expiry is a FENCE. Stock that becomes unsellable on a date
     *       outranks everything, because missing that date is a total loss.
     *  2. then lots with a manufacture date, oldest made first
     *     — an age is a HINT. It breaks the tie expiry cannot see, which for a
     *       tyre shop is every tie there is.
     *  3. undated, unknown-age lots last
     *     — "we do not know when this was made" must not read as "made today"
     *       and jump the queue, nor as "ancient" and be pushed out first.
     *
     * Manufacture date is a TIE-BREAK, never a promotion: a medicine dying next
     * week still goes before an older-made lot with a year left on it.
     *
     * ── Why a scope ─────────────────────────────────────────────────────
     *
     * The same string was written out three times — the batches relation, the
     * FEFO depletion, and the lot a return goes BACK into. The third one is why
     * this is shared rather than fixed in place: a return that lands in a
     * different lot than the sale took it from leaves batch totals right and
     * the shelf wrong.
     */
    public function scopeOldestFirst(Builder $query): Builder
    {
        return $query->orderByRaw(
            'expiry_date IS NULL, expiry_date, manufactured_on IS NULL, manufactured_on'
        );
    }

    /**
     * Lots at or past the warning age with stock still on them — the shelf
     * sweep a shop does before a customer does it for them.
     */
    public function scopeAgedBeyond(Builder $query, int $years): Builder
    {
        return $query
            ->where('quantity', '>', 0)
            ->whereNotNull('manufactured_on')
            ->whereDate('manufactured_on', '<=', now()->subYears($years));
    }

    public function scopeExpiringWithin(Builder $query, int $days): Builder
    {
        return $query
            ->where('quantity', '>', 0)
            ->whereNotNull('expiry_date')
            ->whereDate('expiry_date', '<=', now()->addDays($days));
    }
}
