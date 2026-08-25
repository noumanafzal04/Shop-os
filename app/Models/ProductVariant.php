<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesCostPrice;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductVariant extends BaseModel
{
    /**
     * A size is part of its product's projection, so a change to one is a
     * change to the product the till syncs on. Price, name, retiring a size —
     * all of it reaches a device only because the parent's `updated_at` moved.
     *
     * Stock is covered a level down, on `BranchStock`, where it is written.
     *
     * @var array<int, string>
     */
    protected $touches = ['product'];

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
