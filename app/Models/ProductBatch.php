<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A batch/lot of stock with an expiry date (pharmacy, perishables). Batch
 * quantities live under the product's stock_quantity; sales deplete FEFO.
 */
class ProductBatch extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'expiry_date' => 'date',
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

    public function scopeExpiringWithin(Builder $query, int $days): Builder
    {
        return $query
            ->where('quantity', '>', 0)
            ->whereNotNull('expiry_date')
            ->whereDate('expiry_date', '<=', now()->addDays($days));
    }
}
