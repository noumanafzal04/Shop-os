<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line on a count sheet.
 *
 * `counted_quantity` NULL is the load-bearing case: it means nobody reached
 * this shelf, NOT that the shelf is empty. Treating the two the same would
 * write off every item the counter ran out of time for.
 */
class StockCountItem extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'expected_quantity' => 'decimal:3',
            'counted_quantity' => 'decimal:3',
            'unit_cost' => 'decimal:2',
            'counted_at' => 'datetime',
        ];
    }

    public function stockCount(): BelongsTo
    {
        return $this->belongsTo(StockCount::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }

    public function isCounted(): bool
    {
        return $this->counted_quantity !== null;
    }

    /**
     * Counted minus expected — negative is stock that is missing.
     *
     * Measured against the SNAPSHOT, not live stock: that is what makes it safe
     * to apply as a delta while the shop keeps trading.
     */
    public function variance(): float
    {
        return $this->isCounted()
            ? round((float) $this->counted_quantity - (float) $this->expected_quantity, 3)
            : 0.0;
    }

    /** What the variance is worth at the cost snapshotted when the sheet was drawn. */
    public function varianceValue(): float
    {
        return round($this->variance() * (float) $this->unit_cost, 2);
    }
}
