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
