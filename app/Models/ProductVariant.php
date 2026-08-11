<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesCostPrice;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductVariant extends BaseModel
{
    use BelongsToTenant;

    // A variant carries its own buying price, and rides along inside the
    // product it belongs to — so guarding only Product would leak every
    // variant's cost through the `variants` relation.
    use HidesCostPrice;

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'cost' => 'decimal:2',
            'stock_quantity' => 'decimal:3',
            'low_stock_threshold' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
